import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type {
  AuditActorType,
  AuditEventRecord,
  AdminUserSummary,
  AdminWorkspaceSummary,
  BrowserSessionMode,
  LogLevel,
  PairingTokenResponse,
  PlatformRole,
  TaskArtifact,
  TaskLogRecord,
  TaskMode,
  TaskRecord,
  TaskStreamEvent,
  UserProfile,
  WorkerCapability,
  WorkspaceMemberRecord,
  WorkspaceFileRecord,
  WorkspacePromptTemplateRecord,
  WorkspaceRecord,
  WorkspaceRole,
  WorkerReadinessCheck,
  WorkerRecord
} from "@codexbro/shared";

interface StoredUser extends UserProfile {
  passwordHash: string;
}

interface SessionRecord {
  token: string;
  userId: string;
  createdAt: string;
}

interface PairingTokenRecord {
  token: string;
  userId: string;
  workspaceId: string;
  expiresAt: string;
  usedAt?: string;
}

interface WorkerTokenRecord {
  token: string;
  workerId: string;
  createdAt: string;
}

interface StoredArtifactFile {
  artifactId: string;
  taskId: string;
  filePath: string;
  mimeType: string;
}

interface DataStore {
  users: StoredUser[];
  workspaces: WorkspaceRecord[];
  workspaceMembers: WorkspaceMemberRecord[];
  workspaceFiles: WorkspaceFileRecord[];
  workspacePromptTemplates: WorkspacePromptTemplateRecord[];
  sessions: SessionRecord[];
  pairingTokens: PairingTokenRecord[];
  workerTokens: WorkerTokenRecord[];
  workers: WorkerRecord[];
  tasks: TaskRecord[];
  logs: TaskLogRecord[];
  audits: AuditEventRecord[];
  artifactFiles: StoredArtifactFile[];
}

interface AuthedRequest extends Request {
  user?: StoredUser;
  worker?: WorkerRecord;
}

const app = express();
const events = new EventEmitter();
events.setMaxListeners(500);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = process.env.CODEXBRO_DATA_DIR ?? path.join(rootDir, ".codexbro");
const dataPath = path.join(dataDir, "data.json");
const sqlitePath = path.join(dataDir, "data.sqlite");
const artifactsDir = path.join(dataDir, "artifacts");
const workspaceFilesDir = path.join(dataDir, "workspace-files");
const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST;
const storageMode = process.env.CODEXBRO_STORAGE ?? "sqlite";
const staleWorkerMs = Number(process.env.CODEXBRO_STALE_WORKER_MS ?? 45000);
const staleMaxAttempts = Number(process.env.CODEXBRO_STALE_MAX_ATTEMPTS ?? 3);
const staleRetryBackoffMs = Number(process.env.CODEXBRO_STALE_RETRY_BACKOFF_MS ?? 5000);
const publicServerUrl = (process.env.CODEXBRO_PUBLIC_SERVER_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const bootstrapAdminEmail = (process.env.CODEXBRO_ADMIN_EMAIL ?? "founder@codexbro.local").toLowerCase();
const bootstrapAdminPassword = process.env.CODEXBRO_ADMIN_PASSWORD ?? "codexbro-demo";
const bootstrapAdminDisabled = process.env.CODEXBRO_BOOTSTRAP_ADMIN === "false";
const allowSelfSignup = process.env.CODEXBRO_ALLOW_SELF_SIGNUP === "true";
const corsOrigins = process.env.CODEXBRO_CORS_ORIGIN
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
let sqliteDb: DatabaseSync | null = null;

app.use(cors(corsOrigins?.length ? { origin: corsOrigins } : undefined));
app.use(express.json({ limit: "1mb" }));

let store = loadStore();

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
}

function loadStore(): DataStore {
  if (storageMode === "sqlite") {
    return loadSqliteStore();
  }
  return loadJsonStore();
}

function emptyStore(): DataStore {
  return {
    users: [],
    workspaces: [],
    workspaceMembers: [],
    workspaceFiles: [],
    workspacePromptTemplates: [],
    sessions: [],
    pairingTokens: [],
    workerTokens: [],
    workers: [],
    tasks: [],
    logs: [],
    audits: [],
    artifactFiles: []
  };
}

function normalizeStore(parsed: Partial<DataStore>): DataStore {
  const users = (parsed.users ?? []).map((user) => ({
    ...user,
    platformRole: user.platformRole ?? "user",
    disabledAt: user.disabledAt
  }));
  const existingWorkspaces = parsed.workspaces ?? [];
  const existingMembers = parsed.workspaceMembers ?? [];
  const workspaces = [...existingWorkspaces];
  const workspaceMembers = [...existingMembers];
  const defaultWorkspaceByUser = new Map<string, string>();

  for (const user of users) {
    const existingMember = workspaceMembers.find((member) => member.userId === user.id);
    if (existingMember) {
      defaultWorkspaceByUser.set(user.id, existingMember.workspaceId);
      continue;
    }
    const workspace: WorkspaceRecord = {
      id: id("workspace"),
      name: `${user.email.split("@")[0] || "Personal"} Workspace`,
      createdAt: user.createdAt
    };
    workspaces.push(workspace);
    workspaceMembers.push({
      workspaceId: workspace.id,
      userId: user.id,
      role: "owner",
      createdAt: user.createdAt
    });
    defaultWorkspaceByUser.set(user.id, workspace.id);
  }

  const workspaceForUser = (userId: string) => {
    const workspaceId = defaultWorkspaceByUser.get(userId);
    if (workspaceId) return workspaceId;
    const fallback = workspaces[0]?.id ?? "workspace_legacy";
    if (!workspaces.length) {
      workspaces.push({ id: fallback, name: "Legacy Workspace", createdAt: now() });
    }
    return fallback;
  };

  return {
    users,
    workspaces,
    workspaceMembers,
    workspaceFiles: parsed.workspaceFiles ?? [],
    workspacePromptTemplates: parsed.workspacePromptTemplates ?? [],
    sessions: parsed.sessions ?? [],
    pairingTokens: (parsed.pairingTokens ?? []).map((token) => ({
      ...token,
      workspaceId: token.workspaceId || workspaceForUser(token.userId)
    })),
    workerTokens: parsed.workerTokens ?? [],
    workers: (parsed.workers ?? []).map((worker) => ({
      ...worker,
      workspaceId: worker.workspaceId || workspaceForUser(worker.userId),
      allowedModes: worker.allowedModes ?? ["shell", "codex", "browser", "computer"],
      allowedDirectories: worker.allowedDirectories ?? []
    })),
    tasks: (parsed.tasks ?? []).map((task) => ({
      ...task,
      workspaceId: task.workspaceId || workspaceForUser(task.userId),
      attempt: task.attempt ?? 1,
      nextRunAt: task.nextRunAt,
      browserSessionMode: task.browserSessionMode,
      attachedFileIds: task.attachedFileIds ?? []
    })),
    logs: parsed.logs ?? [],
    audits: parsed.audits ?? [],
    artifactFiles: parsed.artifactFiles ?? []
  };
}

function loadJsonStore(): DataStore {
  if (!fs.existsSync(dataPath)) {
    return emptyStore();
  }

  const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8")) as Partial<DataStore>;
  return normalizeStore(parsed);
}

function database() {
  if (sqliteDb) return sqliteDb;
  fs.mkdirSync(dataDir, { recursive: true });
  sqliteDb = new DatabaseSync(sqlitePath);
  ensureSqliteSchema(sqliteDb);
  return sqliteDb;
}

function ensureSqliteSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      platform_role TEXT NOT NULL DEFAULT 'user',
      disabled_at TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS workspace_files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_workspace_files_workspace_created ON workspace_files(workspace_id, created_at);

    CREATE TABLE IF NOT EXISTS workspace_prompt_templates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_workspace_prompt_templates_workspace_updated ON workspace_prompt_templates(workspace_id, updated_at);

    CREATE TABLE IF NOT EXISTS pairing_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      used_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS worker_tokens (
      token TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      allowed_modes TEXT NOT NULL DEFAULT '["shell","codex","browser","computer"]',
      allowed_directories TEXT NOT NULL,
      browser_profile_dir TEXT,
      native_readiness TEXT,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL,
      browser_session_mode TEXT,
      working_directory TEXT,
      attached_file_ids TEXT NOT NULL DEFAULT '[]',
      idempotency_key TEXT,
      parent_task_id TEXT,
      attempt INTEGER NOT NULL,
      next_run_at TEXT,
      status TEXT NOT NULL,
      approval_granted INTEGER NOT NULL,
      approval_reason TEXT,
      approval_request TEXT,
      cancel_requested_at TEXT,
      canceled_at TEXT,
      result TEXT,
      error TEXT,
      artifacts TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_worker_status ON tasks(worker_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(user_id, idempotency_key);

    CREATE TABLE IF NOT EXISTS task_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_task_logs_task_created ON task_logs(task_id, created_at);

    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      summary TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_audits_user_created ON audits(user_id, created_at);

    CREATE TABLE IF NOT EXISTS artifact_files (
      artifact_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      PRIMARY KEY (artifact_id, task_id)
    ) STRICT;
  `);
  ensureColumn(db, "pairing_tokens", "workspace_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "platform_role", "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, "users", "disabled_at", "TEXT");
  ensureColumn(db, "workers", "workspace_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "workers", "allowed_modes", "TEXT NOT NULL DEFAULT '[\"shell\",\"codex\",\"browser\",\"computer\"]'");
  ensureColumn(db, "workers", "native_readiness", "TEXT");
  ensureColumn(db, "tasks", "workspace_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "tasks", "next_run_at", "TEXT");
  ensureColumn(db, "tasks", "browser_session_mode", "TEXT");
  ensureColumn(db, "tasks", "attached_file_ids", "TEXT NOT NULL DEFAULT '[]'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON tasks(workspace_id, status)");
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function loadSqliteStore(): DataStore {
  const db = database();
  const initialized = db.prepare("SELECT value FROM schema_meta WHERE key = ?")
    .get("relational_initialized") as { value?: string } | undefined;
  if (initialized?.value === "true") {
    return readRelationalStore(db);
  }

  const row = db.prepare("SELECT value FROM kv_store WHERE key = ?").get("data") as { value?: string } | undefined;
  if (row?.value) {
    const migrated = normalizeStore(JSON.parse(row.value) as Partial<DataStore>);
    saveSqliteStore(migrated);
    return migrated;
  }
  const migrated = loadJsonStore();
  saveSqliteStore(migrated);
  return migrated;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}

function readRelationalStore(db: DatabaseSync): DataStore {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all().map((row) => {
    const item = row as Record<string, string>;
    return {
      id: item.id,
      email: item.email,
      passwordHash: item.password_hash,
      platformRole: item.platform_role as PlatformRole,
      disabledAt: item.disabled_at ?? undefined,
      createdAt: item.created_at
    };
  });

  const sessions = db.prepare("SELECT * FROM sessions ORDER BY created_at ASC").all().map((row) => {
    const item = row as Record<string, string>;
    return {
      token: item.token,
      userId: item.user_id,
      createdAt: item.created_at
    };
  });

  const workspaces = db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC").all().map((row) => {
    const item = row as Record<string, string>;
    return {
      id: item.id,
      name: item.name,
      createdAt: item.created_at
    };
  });

  const workspaceMembers = db.prepare("SELECT * FROM workspace_members ORDER BY created_at ASC").all().map((row) => {
    const item = row as Record<string, string>;
    return {
      workspaceId: item.workspace_id,
      userId: item.user_id,
      role: item.role as WorkspaceRole,
      createdAt: item.created_at
    };
  });

  const workspaceFiles = db.prepare("SELECT * FROM workspace_files ORDER BY created_at DESC").all().map((row) => {
    const item = row as Record<string, string | number>;
    return {
      id: item.id as string,
      workspaceId: item.workspace_id as string,
      userId: item.user_id as string,
      name: item.name as string,
      mimeType: item.mime_type as string,
      size: Number(item.size),
      storagePath: item.storage_path as string,
      createdAt: item.created_at as string
    };
  });

  const workspacePromptTemplates = db.prepare("SELECT * FROM workspace_prompt_templates ORDER BY updated_at DESC").all().map((row) => {
    const item = row as Record<string, string>;
    return {
      id: item.id,
      workspaceId: item.workspace_id,
      userId: item.user_id,
      title: item.title,
      description: item.description,
      prompt: item.prompt,
      mode: item.mode as TaskMode,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    };
  });

  const pairingTokens = db.prepare("SELECT * FROM pairing_tokens ORDER BY expires_at DESC").all().map((row) => {
    const item = row as Record<string, string | null>;
    return {
      token: item.token!,
      userId: item.user_id!,
      workspaceId: item.workspace_id!,
      expiresAt: item.expires_at!,
      usedAt: item.used_at ?? undefined
    };
  });

  const workerTokens = db.prepare("SELECT * FROM worker_tokens ORDER BY created_at ASC").all().map((row) => {
    const item = row as Record<string, string>;
    return {
      token: item.token,
      workerId: item.worker_id,
      createdAt: item.created_at
    };
  });

  const workers = db.prepare("SELECT * FROM workers ORDER BY created_at DESC").all().map((row) => {
    const item = row as Record<string, string | null>;
    return {
      id: item.id!,
      workspaceId: item.workspace_id!,
      userId: item.user_id!,
      name: item.name!,
      status: item.status as WorkerRecord["status"],
      capabilities: parseJson<WorkerCapability[]>(item.capabilities, []),
      allowedModes: parseJson<TaskMode[]>(item.allowed_modes, ["shell", "codex", "browser", "computer"]),
      allowedDirectories: parseJson<string[]>(item.allowed_directories, []),
      browserProfileDir: item.browser_profile_dir ?? undefined,
      nativeReadiness: parseJson<WorkerRecord["nativeReadiness"] | undefined>(item.native_readiness, undefined),
      lastSeenAt: item.last_seen_at!,
      createdAt: item.created_at!
    };
  });

  const tasks = db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all().map((row) => {
    const item = row as Record<string, string | number | null>;
    return {
      id: item.id as string,
      workspaceId: item.workspace_id as string,
      userId: item.user_id as string,
      workerId: item.worker_id as string,
      title: item.title as string,
      prompt: item.prompt as string,
      mode: item.mode as TaskMode,
      browserSessionMode: item.browser_session_mode as BrowserSessionMode | undefined,
      workingDirectory: item.working_directory as string | undefined,
      attachedFileIds: parseJson<string[]>(item.attached_file_ids as string | null, []),
      idempotencyKey: item.idempotency_key as string | undefined,
      parentTaskId: item.parent_task_id as string | undefined,
      attempt: Number(item.attempt),
      nextRunAt: item.next_run_at as string | undefined,
      status: item.status as TaskRecord["status"],
      approvalGranted: Number(item.approval_granted) === 1,
      approvalReason: item.approval_reason as string | undefined,
      approvalRequest: parseJson<TaskRecord["approvalRequest"] | undefined>(item.approval_request as string | null, undefined),
      cancelRequestedAt: item.cancel_requested_at as string | undefined,
      canceledAt: item.canceled_at as string | undefined,
      result: item.result as string | undefined,
      error: item.error as string | undefined,
      artifacts: parseJson<TaskArtifact[]>(item.artifacts as string | null, []),
      createdAt: item.created_at as string,
      updatedAt: item.updated_at as string
    };
  });

  const logs = db.prepare("SELECT * FROM task_logs ORDER BY created_at ASC").all().map((row) => {
    const item = row as Record<string, string>;
    return {
      id: item.id,
      taskId: item.task_id,
      level: item.level as LogLevel,
      message: item.message,
      createdAt: item.created_at
    };
  });

  const audits = db.prepare("SELECT * FROM audits ORDER BY created_at DESC").all().map((row) => {
    const item = row as Record<string, string | null>;
    return {
      id: item.id!,
      userId: item.user_id!,
      actorType: item.actor_type as AuditActorType,
      actorId: item.actor_id!,
      action: item.action!,
      targetType: item.target_type as AuditEventRecord["targetType"],
      targetId: item.target_id ?? undefined,
      summary: item.summary!,
      details: parseJson<Record<string, unknown> | undefined>(item.details, undefined),
      createdAt: item.created_at!
    };
  });

  const artifactFiles = db.prepare("SELECT * FROM artifact_files ORDER BY task_id ASC").all().map((row) => {
    const item = row as Record<string, string>;
    return {
      artifactId: item.artifact_id,
      taskId: item.task_id,
      filePath: item.file_path,
      mimeType: item.mime_type
    };
  });

  return normalizeStore({
    users,
    workspaces,
    workspaceMembers,
    workspaceFiles,
    workspacePromptTemplates,
    sessions,
    pairingTokens,
    workerTokens,
    workers,
    tasks,
    logs,
    audits,
    artifactFiles
  });
}

function saveStore() {
  if (storageMode === "sqlite") {
    saveSqliteStore(store);
    return;
  }
  saveJsonStore(store);
}

function saveJsonStore(nextStore: DataStore) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(nextStore, null, 2));
}

function saveSqliteStore(nextStore: DataStore) {
  const db = database();
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DELETE FROM artifact_files;
      DELETE FROM audits;
      DELETE FROM task_logs;
      DELETE FROM tasks;
      DELETE FROM workers;
      DELETE FROM worker_tokens;
      DELETE FROM pairing_tokens;
      DELETE FROM workspace_prompt_templates;
      DELETE FROM workspace_files;
      DELETE FROM workspace_members;
      DELETE FROM workspaces;
      DELETE FROM sessions;
      DELETE FROM users;
    `);

    const insertUser = db.prepare("INSERT INTO users (id, email, password_hash, platform_role, disabled_at, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const user of nextStore.users) {
      insertUser.run(user.id, user.email, user.passwordHash, user.platformRole, user.disabledAt ?? null, user.createdAt);
    }

    const insertSession = db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)");
    for (const session of nextStore.sessions) {
      insertSession.run(session.token, session.userId, session.createdAt);
    }

    const insertWorkspace = db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)");
    for (const workspace of nextStore.workspaces) {
      insertWorkspace.run(workspace.id, workspace.name, workspace.createdAt);
    }

    const insertWorkspaceMember = db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)");
    for (const member of nextStore.workspaceMembers) {
      insertWorkspaceMember.run(member.workspaceId, member.userId, member.role, member.createdAt);
    }

    const insertWorkspaceFile = db.prepare(`
      INSERT INTO workspace_files (
        id, workspace_id, user_id, name, mime_type, size, storage_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const file of nextStore.workspaceFiles) {
      insertWorkspaceFile.run(
        file.id,
        file.workspaceId,
        file.userId,
        file.name,
        file.mimeType,
        file.size,
        file.storagePath!,
        file.createdAt
      );
    }

    const insertPromptTemplate = db.prepare(`
      INSERT INTO workspace_prompt_templates (
        id, workspace_id, user_id, title, description, prompt, mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const template of nextStore.workspacePromptTemplates) {
      insertPromptTemplate.run(
        template.id,
        template.workspaceId,
        template.userId,
        template.title,
        template.description,
        template.prompt,
        template.mode,
        template.createdAt,
        template.updatedAt
      );
    }

    const insertPairing = db.prepare("INSERT INTO pairing_tokens (token, user_id, workspace_id, expires_at, used_at) VALUES (?, ?, ?, ?, ?)");
    for (const token of nextStore.pairingTokens) {
      insertPairing.run(token.token, token.userId, token.workspaceId, token.expiresAt, token.usedAt ?? null);
    }

    const insertWorkerToken = db.prepare("INSERT INTO worker_tokens (token, worker_id, created_at) VALUES (?, ?, ?)");
    for (const token of nextStore.workerTokens) {
      insertWorkerToken.run(token.token, token.workerId, token.createdAt);
    }

    const insertWorker = db.prepare(`
      INSERT INTO workers (
        id, workspace_id, user_id, name, status, capabilities, allowed_modes, allowed_directories,
        browser_profile_dir, native_readiness, last_seen_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const worker of nextStore.workers) {
      insertWorker.run(
        worker.id,
        worker.workspaceId,
        worker.userId,
        worker.name,
        worker.status,
        JSON.stringify(worker.capabilities),
        JSON.stringify(worker.allowedModes),
        JSON.stringify(worker.allowedDirectories),
        worker.browserProfileDir ?? null,
        worker.nativeReadiness ? JSON.stringify(worker.nativeReadiness) : null,
        worker.lastSeenAt,
        worker.createdAt
      );
    }

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, workspace_id, user_id, worker_id, title, prompt, mode, browser_session_mode, working_directory,
        attached_file_ids, idempotency_key, parent_task_id, attempt, next_run_at, status, approval_granted,
        approval_reason, approval_request, cancel_requested_at, canceled_at,
        result, error, artifacts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const task of nextStore.tasks) {
      insertTask.run(
        task.id,
        task.workspaceId,
        task.userId,
        task.workerId,
        task.title,
        task.prompt,
        task.mode,
        task.browserSessionMode ?? null,
        task.workingDirectory ?? null,
        JSON.stringify(task.attachedFileIds ?? []),
        task.idempotencyKey ?? null,
        task.parentTaskId ?? null,
        task.attempt,
        task.nextRunAt ?? null,
        task.status,
        task.approvalGranted ? 1 : 0,
        task.approvalReason ?? null,
        task.approvalRequest ? JSON.stringify(task.approvalRequest) : null,
        task.cancelRequestedAt ?? null,
        task.canceledAt ?? null,
        task.result ?? null,
        task.error ?? null,
        JSON.stringify(task.artifacts),
        task.createdAt,
        task.updatedAt
      );
    }

    const insertLog = db.prepare("INSERT INTO task_logs (id, task_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const log of nextStore.logs) {
      insertLog.run(log.id, log.taskId, log.level, log.message, log.createdAt);
    }

    const insertAudit = db.prepare(`
      INSERT INTO audits (
        id, user_id, actor_type, actor_id, action, target_type,
        target_id, summary, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const audit of nextStore.audits) {
      insertAudit.run(
        audit.id,
        audit.userId,
        audit.actorType,
        audit.actorId,
        audit.action,
        audit.targetType,
        audit.targetId ?? null,
        audit.summary,
        audit.details ? JSON.stringify(audit.details) : null,
        audit.createdAt
      );
    }

    const insertArtifactFile = db.prepare("INSERT INTO artifact_files (artifact_id, task_id, file_path, mime_type) VALUES (?, ?, ?, ?)");
    for (const artifactFile of nextStore.artifactFiles) {
      insertArtifactFile.run(artifactFile.artifactId, artifactFile.taskId, artifactFile.filePath, artifactFile.mimeType);
    }

    db.prepare(`
      INSERT INTO schema_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run("relational_initialized", "true", timestamp);

    db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run("data", JSON.stringify(nextStore), timestamp);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const testHash = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(testHash, "hex"));
}

function publicUser(user: StoredUser): UserProfile {
  return {
    id: user.id,
    email: user.email,
    platformRole: user.platformRole,
    disabledAt: user.disabledAt,
    createdAt: user.createdAt
  };
}

function publicWorkspaceFile(file: WorkspaceFileRecord): WorkspaceFileRecord {
  const { storagePath: _storagePath, ...publicFile } = file;
  return publicFile;
}

function publicPromptTemplate(template: WorkspacePromptTemplateRecord): WorkspacePromptTemplateRecord {
  return template;
}

function userWorkspaceFile(userId: string, fileId: string) {
  const workspaceIds = userWorkspaceIds(userId);
  return store.workspaceFiles.find((file) => file.id === fileId && workspaceIds.includes(file.workspaceId));
}

function readBearer(req: Request) {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  if (typeof req.query.token === "string") return req.query.token;
  return undefined;
}

function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readBearer(req);
  const session = store.sessions.find((item) => item.token === token);
  const user = session ? store.users.find((item) => item.id === session.userId) : undefined;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (user.disabledAt) {
    res.status(403).json({ error: "User is disabled" });
    return;
  }
  req.user = user;
  next();
}

function requirePlatformAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  requireUser(req, res, () => {
    if (req.user?.platformRole !== "admin") {
      res.status(403).json({ error: "Platform admin access required" });
      return;
    }
    next();
  });
}

function requireWorker(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readBearer(req);
  const workerToken = store.workerTokens.find((item) => item.token === token);
  const worker = workerToken ? store.workers.find((item) => item.id === workerToken.workerId) : undefined;
  if (!worker) {
    res.status(401).json({ error: "Unauthorized worker" });
    return;
  }
  worker.lastSeenAt = now();
  worker.status = "online";
  saveStore();
  req.worker = worker;
  next();
}

function userWorker(userId: string, workerId: string) {
  const workspaceIds = userWorkspaceIds(userId);
  return store.workers.find((worker) => worker.id === workerId && workspaceIds.includes(worker.workspaceId));
}

function userWorkspaceIds(userId: string) {
  return store.workspaceMembers
    .filter((member) => member.userId === userId)
    .map((member) => member.workspaceId);
}

function defaultWorkspace(user: StoredUser) {
  const existingMember = store.workspaceMembers.find((item) => item.userId === user.id);
  if (existingMember) {
    const workspace = store.workspaces.find((item) => item.id === existingMember.workspaceId);
    if (workspace) return workspace;
  }

  const workspace: WorkspaceRecord = {
    id: id("workspace"),
    name: `${user.email.split("@")[0] || "Personal"} Workspace`,
    createdAt: now()
  };
  const member: WorkspaceMemberRecord = {
    workspaceId: workspace.id,
    userId: user.id,
    role: "owner",
    createdAt: workspace.createdAt
  };
  store.workspaces.push(workspace);
  store.workspaceMembers.push(member);
  saveStore();
  return workspace;
}

function bootstrapAdminUser() {
  if (bootstrapAdminDisabled) return;
  const timestamp = now();
  let changed = false;
  let user = store.users.find((item) => item.email === bootstrapAdminEmail);
  if (!user) {
    user = {
      id: id("user"),
      email: bootstrapAdminEmail,
      passwordHash: hashPassword(bootstrapAdminPassword),
      platformRole: "admin",
      createdAt: timestamp
    };
    store.users.push(user);
    changed = true;
  }
  if (user.platformRole !== "admin") {
    user.platformRole = "admin";
    changed = true;
  }
  if (user.disabledAt) {
    user.disabledAt = undefined;
    changed = true;
  }
  defaultWorkspace(user);
  if (changed) saveStore();
}

function adminUsers(): AdminUserSummary[] {
  return store.users.map((user) => ({
    ...publicUser(user),
    workspaces: store.workspaceMembers
      .filter((member) => member.userId === user.id)
      .flatMap((member) => {
        const workspace = store.workspaces.find((item) => item.id === member.workspaceId);
        return workspace ? [{ ...workspace, role: member.role }] : [];
      })
  }));
}

function adminWorkspaces(): AdminWorkspaceSummary[] {
  return store.workspaces.map((workspace) => ({
    ...workspace,
    memberCount: store.workspaceMembers.filter((member) => member.workspaceId === workspace.id).length
  }));
}

function assertWorkspaceRole(value: unknown): WorkspaceRole {
  return value === "admin" || value === "operator" || value === "viewer" ? value : "owner";
}

function assertPlatformRole(value: unknown): PlatformRole {
  return value === "admin" ? "admin" : "user";
}

function workspaceRole(userId: string, workspaceId: string) {
  return store.workspaceMembers.find((member) => member.userId === userId && member.workspaceId === workspaceId)?.role;
}

function canOperateWorkspace(userId: string, workspaceId: string) {
  const role = workspaceRole(userId, workspaceId);
  return role === "owner" || role === "admin" || role === "operator";
}

function assertAllowedModes(value: unknown, capabilities: WorkerCapability[]): TaskMode[] {
  const taskModes: TaskMode[] = ["shell", "codex", "browser", "computer"];
  const capabilityModes = capabilities.filter((item): item is TaskMode => taskModes.includes(item as TaskMode));
  if (!Array.isArray(value)) return capabilityModes.length ? capabilityModes : ["shell"];
  const modes = value.filter((item): item is TaskMode => typeof item === "string" && taskModes.includes(item as TaskMode));
  return modes.length ? modes : capabilityModes.length ? capabilityModes : ["shell"];
}

function pushTaskEvent(task: TaskRecord) {
  const payload: TaskStreamEvent = { type: "task", task };
  events.emit(`task:${task.id}`, payload);
}

function addLog(taskId: string, level: LogLevel, message: string) {
  const log: TaskLogRecord = {
    id: id("log"),
    taskId,
    level,
    message,
    createdAt: now()
  };
  store.logs.push(log);
  saveStore();
  const payload: TaskStreamEvent = { type: "log", log };
  events.emit(`task:${taskId}`, payload);
  return log;
}

function addAudit(event: Omit<AuditEventRecord, "id" | "createdAt">) {
  const audit: AuditEventRecord = {
    id: id("audit"),
    createdAt: now(),
    ...event
  };
  store.audits.unshift(audit);
  store.audits = store.audits.slice(0, 1000);
  saveStore();
  return audit;
}

function auditForTask(
  task: TaskRecord,
  actorType: AuditActorType,
  actorId: string,
  action: string,
  summary: string,
  details?: Record<string, unknown>
) {
  addAudit({
    userId: task.userId,
    actorType,
    actorId,
    action,
    targetType: "task",
    targetId: task.id,
    summary,
    details
  });
}

function updateTask(task: TaskRecord, updates: Partial<TaskRecord>) {
  Object.assign(task, updates, { updatedAt: now() });
  saveStore();
  pushTaskEvent(task);
  return task;
}

function isTerminalStatus(status: TaskRecord["status"]) {
  return status === "completed" || status === "failed" || status === "canceled";
}

function retryDelayMs(attempt: number) {
  return staleRetryBackoffMs * 2 ** Math.max(0, attempt - 1);
}

function canClaimTask(task: TaskRecord, workerId: string) {
  return task.workerId === workerId &&
    task.status === "pending" &&
    (!task.nextRunAt || Date.parse(task.nextRunAt) <= Date.now());
}

function recoverStaleRunningTasks() {
  for (const task of store.tasks) {
    if (task.status !== "running" && task.status !== "canceling") continue;
    const worker = store.workers.find((item) => item.id === task.workerId);
    if (!worker || Date.now() - Date.parse(worker.lastSeenAt) < staleWorkerMs) continue;

    if (task.status === "canceling") {
      addLog(task.id, "warn", "Worker disconnected while canceling. Task marked canceled.");
      updateTask(task, {
        status: "canceled",
        canceledAt: now(),
        result: "Task canceled after worker disconnected."
      });
      auditForTask(task, "system", "server", "task.canceled", "Task canceled after worker disconnected.");
      continue;
    }

    if (task.attempt >= staleMaxAttempts) {
      addLog(task.id, "error", `Worker heartbeat went stale after ${task.attempt} attempts. Task failed.`);
      updateTask(task, {
        status: "failed",
        error: `Worker heartbeat went stale after ${task.attempt} attempts.`
      });
      auditForTask(task, "system", "server", "task.failed", "Task failed after stale retry limit was reached.", {
        attempt: task.attempt,
        maxAttempts: staleMaxAttempts
      });
      continue;
    }

    const nextAttempt = task.attempt + 1;
    const nextRunAt = new Date(Date.now() + retryDelayMs(task.attempt)).toISOString();
    addLog(task.id, "warn", `Worker heartbeat went stale. Task returned to the queue for attempt ${nextAttempt} at ${nextRunAt}.`);
    updateTask(task, {
      status: "pending",
      attempt: nextAttempt,
      nextRunAt
    });
    auditForTask(task, "system", "server", "task.requeued", "Task requeued after worker heartbeat went stale.", {
      attempt: nextAttempt,
      nextRunAt,
      maxAttempts: staleMaxAttempts
    });
  }
}

function taskTitle(prompt: string) {
  return prompt.trim().replace(/\s+/g, " ").slice(0, 64) || "Untitled task";
}

function activeDuplicateTask(userId: string, idempotencyKey: string | undefined) {
  if (!idempotencyKey) return undefined;
  const workspaceIds = userWorkspaceIds(userId);
  return store.tasks.find((task) =>
    task.userId === userId &&
    workspaceIds.includes(task.workspaceId) &&
    task.idempotencyKey === idempotencyKey &&
    !isTerminalStatus(task.status)
  );
}

function createTask(input: {
  workspaceId: string;
  userId: string;
  workerId: string;
  prompt: string;
  mode: TaskMode;
  browserSessionMode?: BrowserSessionMode;
  workingDirectory?: string;
  attachedFileIds?: string[];
  idempotencyKey?: string;
  parentTaskId?: string;
  attempt?: number;
}) {
  const timestamp = now();
  const task: TaskRecord = {
    id: id("task"),
    workspaceId: input.workspaceId,
    userId: input.userId,
    workerId: input.workerId,
    title: taskTitle(input.prompt),
    prompt: input.prompt,
    mode: input.mode,
    browserSessionMode: input.browserSessionMode,
    workingDirectory: input.workingDirectory,
    attachedFileIds: input.attachedFileIds ?? [],
    idempotencyKey: input.idempotencyKey,
    parentTaskId: input.parentTaskId,
    attempt: input.attempt ?? 1,
    status: "pending",
    approvalGranted: false,
    artifacts: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  store.tasks.unshift(task);
  return task;
}

function assertBodyString(req: Request, key: string) {
  const value = req.body?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function optionalBodyString(req: Request, key: string) {
  const value = req.body?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertTaskMode(value: unknown): TaskMode {
  return value === "codex" || value === "browser" || value === "computer" ? value : "shell";
}

function assertBrowserSessionMode(value: unknown): BrowserSessionMode {
  return value === "ephemeral" ? "ephemeral" : "persistent";
}

function assertCapabilities(value: unknown): WorkerCapability[] {
  const allowed: WorkerCapability[] = ["shell", "codex", "browser", "computer"];
  if (!Array.isArray(value)) return ["shell", "codex"];
  const capabilities = value.filter((item): item is WorkerCapability =>
    typeof item === "string" && allowed.includes(item as WorkerCapability)
  );
  return capabilities.length ? capabilities : ["shell", "codex"];
}

function assertStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function assertNativeReadiness(value: unknown): WorkerRecord["nativeReadiness"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const backend = raw.backend;
  if (backend !== "desktop" && backend !== "app-server" && backend !== "exec") return undefined;
  const readiness: NonNullable<WorkerRecord["nativeReadiness"]> = {
    backend,
    codexCli: assertReadinessCheck(raw.codexCli) ?? {
      ok: false,
      detail: "Codex CLI readiness was not reported.",
      checkedAt: now(),
      status: "unavailable"
    }
  };
  for (const key of ["codexAppServer", "codexDesktopBridge", "codexDesktopSmoke", "cuaDriver", "chrome"] as const) {
    const check = assertReadinessCheck(raw[key]);
    if (check) readiness[key] = check;
  }
  return readiness;
}

function assertReadinessCheck(value: unknown): WorkerReadinessCheck | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const status: WorkerReadinessCheck["status"] = raw.status === "ready" || raw.status === "available" || raw.status === "warning" || raw.status === "unavailable"
    ? raw.status
    : undefined;
  return {
    ok: raw.ok === true,
    detail: typeof raw.detail === "string" ? raw.detail.slice(0, 500) : "",
    checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : now(),
    ...(status ? { status } : {})
  };
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "artifact";
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function persistArtifacts(task: TaskRecord, rawArtifacts: unknown) {
  if (!Array.isArray(rawArtifacts)) return [];

  return rawArtifacts.flatMap((raw): TaskArtifact[] => {
    if (!raw || typeof raw !== "object") return [];
    const candidate = raw as Partial<TaskArtifact> & { mimeType?: string };
    const name = typeof candidate.name === "string" ? candidate.name : "artifact.txt";
    const type = candidate.type === "file" || candidate.type === "url" ? candidate.type : "text";
    const value = typeof candidate.value === "string" ? candidate.value : "";
    const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : now();
    const artifactId = typeof candidate.id === "string" ? candidate.id : id("artifact");

    if (type !== "file") {
      return [{ id: artifactId, name, type, value, createdAt }];
    }

    const match = value.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = candidate.mimeType ?? match?.[1] ?? "application/octet-stream";
    const bytes = match ? Buffer.from(match[2], "base64") : Buffer.from(value, "base64");
    const taskArtifactDir = path.join(artifactsDir, task.id);
    fs.mkdirSync(taskArtifactDir, { recursive: true });
    const filePath = path.join(taskArtifactDir, `${artifactId}-${sanitizeFilename(name)}`);
    fs.writeFileSync(filePath, bytes);
    store.artifactFiles.push({
      artifactId,
      taskId: task.id,
      filePath,
      mimeType
    });

    return [{
      id: artifactId,
      name,
      type: "file",
      value: `/api/tasks/${task.id}/artifacts/${artifactId}/download`,
      createdAt
    }];
  });
}

bootstrapAdminUser();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "codexbro-server", time: now() });
});

app.post("/api/auth/login", (req, res) => {
  const email = assertBodyString(req, "email").toLowerCase();
  const password = assertBodyString(req, "password");
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  let user = store.users.find((item) => item.email === email);
  if (user && !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (user?.disabledAt) {
    res.status(403).json({ error: "User is disabled" });
    return;
  }

  if (!user) {
    if (!allowSelfSignup) {
      res.status(401).json({ error: "Account has not been created by an administrator" });
      return;
    }
    user = {
      id: id("user"),
      email,
      passwordHash: hashPassword(password),
      platformRole: "user",
      createdAt: now()
    };
    store.users.push(user);
  }

  defaultWorkspace(user);

  const session: SessionRecord = {
    token: id("sess"),
    userId: user.id,
    createdAt: now()
  };
  store.sessions.push(session);
  addAudit({
    userId: user.id,
    actorType: "user",
    actorId: user.id,
    action: "auth.login",
    targetType: "auth",
    targetId: user.id,
    summary: `${user.email} signed in.`
  });
  saveStore();
  res.json({ token: session.token, user: publicUser(user) });
});

app.get("/api/me", requireUser, (req: AuthedRequest, res) => {
  res.json({ user: publicUser(req.user!) });
});

app.get("/api/admin/users", requirePlatformAdmin, (_req: AuthedRequest, res) => {
  res.json({ users: adminUsers(), workspaces: adminWorkspaces() });
});

app.post("/api/admin/users", requirePlatformAdmin, (req: AuthedRequest, res) => {
  const email = assertBodyString(req, "email").toLowerCase();
  const password = assertBodyString(req, "password");
  const workspaceName = optionalBodyString(req, "workspaceName");
  const platformRole = assertPlatformRole(req.body?.platformRole);
  const workspaceRole = assertWorkspaceRole(req.body?.workspaceRole);
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (store.users.some((item) => item.email === email)) {
    res.status(409).json({ error: "User already exists" });
    return;
  }

  const timestamp = now();
  const user: StoredUser = {
    id: id("user"),
    email,
    passwordHash: hashPassword(password),
    platformRole,
    createdAt: timestamp
  };
  const workspace: WorkspaceRecord = {
    id: id("workspace"),
    name: workspaceName ?? `${email.split("@")[0] || "Customer"} Workspace`,
    createdAt: timestamp
  };
  store.users.push(user);
  store.workspaces.push(workspace);
  store.workspaceMembers.push({
    workspaceId: workspace.id,
    userId: user.id,
    role: workspaceRole,
    createdAt: timestamp
  });
  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "admin.user.created",
    targetType: "user",
    targetId: user.id,
    summary: `${req.user!.email} created customer account ${user.email}.`,
    details: {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRole,
      platformRole
    }
  });
  saveStore();
  res.status(201).json({ user: adminUsers().find((item) => item.id === user.id), workspace });
});

app.patch("/api/admin/users/:userId", requirePlatformAdmin, (req: AuthedRequest, res) => {
  const userId = String(req.params.userId ?? "");
  const user = store.users.find((item) => item.id === userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const password = optionalBodyString(req, "password");
  const disabled = typeof req.body?.disabled === "boolean" ? req.body.disabled : undefined;
  const platformRole = req.body?.platformRole === undefined ? undefined : assertPlatformRole(req.body.platformRole);

  if (password) {
    user.passwordHash = hashPassword(password);
  }
  if (disabled !== undefined) {
    if (disabled && user.id === req.user!.id) {
      res.status(400).json({ error: "Administrators cannot disable their own account" });
      return;
    }
    user.disabledAt = disabled ? now() : undefined;
    if (disabled) {
      store.sessions = store.sessions.filter((session) => session.userId !== user.id);
    }
  }
  if (platformRole) {
    if (user.id === req.user!.id && platformRole !== "admin") {
      res.status(400).json({ error: "Administrators cannot remove their own admin role" });
      return;
    }
    user.platformRole = platformRole;
  }

  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "admin.user.updated",
    targetType: "user",
    targetId: user.id,
    summary: `${req.user!.email} updated customer account ${user.email}.`,
    details: {
      passwordReset: Boolean(password),
      disabled,
      platformRole
    }
  });
  saveStore();
  res.json({ user: adminUsers().find((item) => item.id === user.id) });
});

app.get("/api/workspaces", requireUser, (req: AuthedRequest, res) => {
  const memberships = store.workspaceMembers.filter((member) => member.userId === req.user!.id);
  const workspaces = memberships.flatMap((member) => {
    const workspace = store.workspaces.find((item) => item.id === member.workspaceId);
    return workspace ? [{ ...workspace, role: member.role }] : [];
  });
  res.json({ workspaces });
});

app.post("/api/workers/pairing-token", requireUser, (req: AuthedRequest, res) => {
  const requestedWorkspaceId = optionalBodyString(req, "workspaceId");
  const workspace = requestedWorkspaceId
    ? store.workspaces.find((item) => item.id === requestedWorkspaceId)
    : defaultWorkspace(req.user!);
  if (!workspace || !canOperateWorkspace(req.user!.id, workspace.id)) {
    res.status(403).json({ error: "You do not have permission to pair workers in this workspace" });
    return;
  }
  const token = id("pair");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();
  store.pairingTokens.push({
    token,
    userId: req.user!.id,
    workspaceId: workspace.id,
    expiresAt
  });
  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "worker.pairing_token.created",
    targetType: "worker",
    summary: "Pairing token created for a local worker.",
    details: { expiresAt, workspaceId: workspace.id }
  });
  saveStore();
  const baseCommand = `npm run worker -- --server ${shellQuote(publicServerUrl)} --pairing-token ${shellQuote(token)} --token-file .codexbro/worker-token.json`;
  const desktopCommand = [
    "CODEXBRO_NATIVE_TASK_BACKEND=desktop",
    "CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true",
    "CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true",
    baseCommand,
    "--allowed-dir /path/to/project",
    "--allowed-mode shell",
    "--allowed-mode codex",
    "--allowed-mode browser",
    "--allowed-mode computer"
  ].join(" ");
  const response: PairingTokenResponse = {
    pairingToken: token,
    expiresAt,
    command: baseCommand,
    desktopCommand,
    recommendedCommand: desktopCommand,
    workspaceId: workspace.id
  };
  res.json(response);
});

app.get("/api/workers", requireUser, (req: AuthedRequest, res) => {
  recoverStaleRunningTasks();
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const workers = store.workers
    .filter((worker) => workspaceIds.includes(worker.workspaceId))
    .map((worker) => ({
      ...worker,
      status: Date.now() - Date.parse(worker.lastSeenAt) < 15000 ? "online" : "offline"
    }));
  res.json({ workers });
});

app.delete("/api/workers/:workerId", requireUser, (req: AuthedRequest, res) => {
  const workerId = String(req.params.workerId ?? "");
  const worker = userWorker(req.user!.id, workerId);
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  if (!canOperateWorkspace(req.user!.id, worker.workspaceId)) {
    res.status(403).json({ error: "You do not have permission to unbind workers in this workspace" });
    return;
  }

  const revokedTokens = store.workerTokens.filter((token) => token.workerId === worker.id).length;
  store.workerTokens = store.workerTokens.filter((token) => token.workerId !== worker.id);
  store.workers = store.workers.filter((item) => item.id !== worker.id);

  for (const task of store.tasks.filter((item) => item.workerId === worker.id && !isTerminalStatus(item.status))) {
    addLog(task.id, "warn", `${worker.name} was unbound. Task failed before it could continue.`);
    updateTask(task, {
      status: "failed",
      error: "Worker was unbound before the task completed."
    });
    auditForTask(task, "user", req.user!.id, "task.failed", "Task failed because its worker was unbound.", {
      workerId: worker.id
    });
  }

  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "worker.unbound",
    targetType: "worker",
    targetId: worker.id,
    summary: `${worker.name} was unbound and its local token was revoked.`,
    details: {
      workerId: worker.id,
      workspaceId: worker.workspaceId,
      revokedTokens
    }
  });
  saveStore();
  res.json({ ok: true, workerId: worker.id, revokedTokens });
});

app.get("/api/workspace-files", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const requestedWorkspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (requestedWorkspaceId && !workspaceIds.includes(requestedWorkspaceId)) {
    res.status(403).json({ error: "You do not have permission to view files in this workspace" });
    return;
  }
  const allowedWorkspaceIds = requestedWorkspaceId ? [requestedWorkspaceId] : workspaceIds;
  const files = store.workspaceFiles
    .filter((file) => allowedWorkspaceIds.includes(file.workspaceId))
    .map(publicWorkspaceFile);
  res.json({ files });
});

app.get("/api/prompt-templates", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const requestedWorkspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (requestedWorkspaceId && !workspaceIds.includes(requestedWorkspaceId)) {
    res.status(403).json({ error: "You do not have permission to view prompt templates in this workspace" });
    return;
  }
  const allowedWorkspaceIds = requestedWorkspaceId ? [requestedWorkspaceId] : workspaceIds;
  const templates = store.workspacePromptTemplates
    .filter((template) => allowedWorkspaceIds.includes(template.workspaceId))
    .map(publicPromptTemplate);
  res.json({ templates });
});

app.post("/api/workspaces/:workspaceId/prompt-templates", requireUser, (req: AuthedRequest, res) => {
  const workspace = store.workspaces.find((item) => item.id === req.params.workspaceId);
  if (!workspace || !canOperateWorkspace(req.user!.id, workspace.id)) {
    res.status(403).json({ error: "You do not have permission to create prompt templates in this workspace" });
    return;
  }
  const title = assertBodyString(req, "title");
  const description = assertBodyString(req, "description");
  const prompt = assertBodyString(req, "prompt");
  const mode = assertTaskMode(req.body?.mode);
  if (!title || !prompt) {
    res.status(400).json({ error: "Template title and prompt are required" });
    return;
  }
  const timestamp = now();
  const template: WorkspacePromptTemplateRecord = {
    id: id("template"),
    workspaceId: workspace.id,
    userId: req.user!.id,
    title,
    description,
    prompt,
    mode,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  store.workspacePromptTemplates.unshift(template);
  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "prompt_template.created",
    targetType: "prompt_template",
    targetId: template.id,
    summary: `Created prompt template ${template.title}.`,
    details: { workspaceId: workspace.id, mode }
  });
  saveStore();
  res.status(201).json({ template: publicPromptTemplate(template) });
});

app.patch("/api/prompt-templates/:templateId", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const template = store.workspacePromptTemplates.find((item) => item.id === req.params.templateId && workspaceIds.includes(item.workspaceId));
  if (!template) {
    res.status(404).json({ error: "Prompt template not found" });
    return;
  }
  if (!canOperateWorkspace(req.user!.id, template.workspaceId)) {
    res.status(403).json({ error: "You do not have permission to update prompt templates in this workspace" });
    return;
  }
  const title = assertBodyString(req, "title");
  const description = assertBodyString(req, "description");
  const prompt = assertBodyString(req, "prompt");
  const mode = assertTaskMode(req.body?.mode);
  if (!title || !prompt) {
    res.status(400).json({ error: "Template title and prompt are required" });
    return;
  }
  Object.assign(template, {
    title,
    description,
    prompt,
    mode,
    updatedAt: now()
  });
  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "prompt_template.updated",
    targetType: "prompt_template",
    targetId: template.id,
    summary: `Updated prompt template ${template.title}.`,
    details: { workspaceId: template.workspaceId, mode }
  });
  saveStore();
  res.json({ template: publicPromptTemplate(template) });
});

app.delete("/api/prompt-templates/:templateId", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const template = store.workspacePromptTemplates.find((item) => item.id === req.params.templateId && workspaceIds.includes(item.workspaceId));
  if (!template) {
    res.status(404).json({ error: "Prompt template not found" });
    return;
  }
  if (!canOperateWorkspace(req.user!.id, template.workspaceId)) {
    res.status(403).json({ error: "You do not have permission to delete prompt templates in this workspace" });
    return;
  }
  store.workspacePromptTemplates = store.workspacePromptTemplates.filter((item) => item.id !== template.id);
  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "prompt_template.deleted",
    targetType: "prompt_template",
    targetId: template.id,
    summary: `Deleted prompt template ${template.title}.`,
    details: { workspaceId: template.workspaceId }
  });
  saveStore();
  res.json({ ok: true });
});

app.post("/api/workspaces/:workspaceId/files", requireUser, express.raw({ type: "*/*", limit: "50mb" }), (req: AuthedRequest, res) => {
  const workspace = store.workspaces.find((item) => item.id === req.params.workspaceId);
  if (!workspace || !canOperateWorkspace(req.user!.id, workspace.id)) {
    res.status(403).json({ error: "You do not have permission to upload files in this workspace" });
    return;
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "File body is required" });
    return;
  }
  const originalName = decodeURIComponent(req.header("x-file-name") ?? "").trim();
  if (!originalName) {
    res.status(400).json({ error: "x-file-name header is required" });
    return;
  }
  const fileId = id("file");
  const timestamp = now();
  const workspaceDir = path.join(workspaceFilesDir, workspace.id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const storagePath = path.join(workspaceDir, `${fileId}-${sanitizeFilename(originalName)}`);
  fs.writeFileSync(storagePath, req.body);
  const file: WorkspaceFileRecord = {
    id: fileId,
    workspaceId: workspace.id,
    userId: req.user!.id,
    name: originalName,
    mimeType: req.header("content-type") || "application/octet-stream",
    size: req.body.length,
    storagePath,
    createdAt: timestamp
  };
  store.workspaceFiles.unshift(file);
  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "workspace_file.uploaded",
    targetType: "artifact",
    targetId: file.id,
    summary: `Uploaded workspace file ${file.name}.`,
    details: { workspaceId: workspace.id, size: file.size, mimeType: file.mimeType }
  });
  saveStore();
  res.status(201).json({ file: publicWorkspaceFile(file) });
});

app.get("/api/workspace-files/:fileId/download", requireUser, (req: AuthedRequest, res) => {
  const fileId = String(req.params.fileId);
  const file = userWorkspaceFile(req.user!.id, fileId);
  if (!file?.storagePath || !fs.existsSync(file.storagePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file.name)}"`);
  createReadStream(file.storagePath).pipe(res);
});

app.delete("/api/workspace-files/:fileId", requireUser, (req: AuthedRequest, res) => {
  const fileId = String(req.params.fileId);
  const file = userWorkspaceFile(req.user!.id, fileId);
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  if (!canOperateWorkspace(req.user!.id, file.workspaceId)) {
    res.status(403).json({ error: "You do not have permission to delete files in this workspace" });
    return;
  }
  store.workspaceFiles = store.workspaceFiles.filter((item) => item.id !== file.id);
  for (const task of store.tasks) {
    if (task.attachedFileIds.includes(file.id)) {
      task.attachedFileIds = task.attachedFileIds.filter((id) => id !== file.id);
    }
  }
  if (file.storagePath) fs.rmSync(file.storagePath, { force: true });
  addAudit({
    userId: req.user!.id,
    actorType: "user",
    actorId: req.user!.id,
    action: "workspace_file.deleted",
    targetType: "artifact",
    targetId: file.id,
    summary: `Deleted workspace file ${file.name}.`,
    details: { workspaceId: file.workspaceId }
  });
  saveStore();
  res.json({ ok: true });
});

app.get("/api/audit", requireUser, (req: AuthedRequest, res) => {
  const audits = store.audits
    .filter((audit) => audit.userId === req.user!.id)
    .slice(0, 200);
  res.json({ audits });
});

app.post("/api/tasks", requireUser, (req: AuthedRequest, res) => {
  const prompt = assertBodyString(req, "prompt");
  const workerId = assertBodyString(req, "workerId");
  const workingDirectory = optionalBodyString(req, "workingDirectory");
  const idempotencyKey = optionalBodyString(req, "idempotencyKey");
  const attachedFileIds = assertStringArray(req.body?.attachedFileIds);
  const mode = assertTaskMode(req.body?.mode);
  const browserSessionMode = mode === "browser" || mode === "computer" ? assertBrowserSessionMode(req.body?.browserSessionMode) : undefined;
  if (!prompt || !workerId) {
    res.status(400).json({ error: "Prompt and workerId are required" });
    return;
  }

  const worker = userWorker(req.user!.id, workerId);
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  if (!canOperateWorkspace(req.user!.id, worker.workspaceId)) {
    res.status(403).json({ error: "You do not have permission to create tasks in this workspace" });
    return;
  }
  if (!worker.allowedModes.includes(mode)) {
    res.status(403).json({ error: `Worker does not allow ${mode} tasks` });
    return;
  }
  const attachedFiles = attachedFileIds.map((fileId) => store.workspaceFiles.find((file) => file.id === fileId));
  if (attachedFiles.some((file) => !file || file.workspaceId !== worker.workspaceId)) {
    res.status(400).json({ error: "Attached files must exist in the target worker workspace" });
    return;
  }

  const duplicate = activeDuplicateTask(req.user!.id, idempotencyKey);
  if (duplicate) {
    addLog(duplicate.id, "info", "Duplicate create request matched this active idempotency key.");
    auditForTask(duplicate, "user", req.user!.id, "task.create.deduped", "Duplicate create request returned existing task.", {
      idempotencyKey
    });
    res.status(200).json({ task: duplicate, deduped: true });
    return;
  }

  const task = createTask({
    workspaceId: worker.workspaceId,
    userId: req.user!.id,
    workerId,
    prompt,
    mode,
    browserSessionMode,
    workingDirectory,
    attachedFileIds,
    idempotencyKey
  });
  saveStore();
  addLog(task.id, "info", `Task queued for ${worker.name} in ${mode} mode.`);
  auditForTask(task, "user", req.user!.id, "task.created", `Task queued for ${worker.name}.`, {
    mode,
    browserSessionMode,
    workerId,
    workingDirectory,
    attachedFileIds,
    idempotencyKey
  });
  res.status(201).json({ task });
});

app.post("/api/tasks/:taskId/retry", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const original = store.tasks.find((item) => item.id === req.params.taskId && workspaceIds.includes(item.workspaceId));
  if (!original) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (!isTerminalStatus(original.status)) {
    res.status(400).json({ error: "Only finished tasks can be retried" });
    return;
  }
  const worker = userWorker(req.user!.id, original.workerId);
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  if (!canOperateWorkspace(req.user!.id, original.workspaceId)) {
    res.status(403).json({ error: "You do not have permission to retry tasks in this workspace" });
    return;
  }
  if (!worker.allowedModes.includes(original.mode)) {
    res.status(403).json({ error: `Worker does not allow ${original.mode} tasks` });
    return;
  }

  const task = createTask({
    workspaceId: original.workspaceId,
    userId: original.userId,
    workerId: original.workerId,
    prompt: original.prompt,
    mode: original.mode,
    browserSessionMode: original.browserSessionMode,
    workingDirectory: original.workingDirectory,
    attachedFileIds: original.attachedFileIds,
    parentTaskId: original.id,
    attempt: original.attempt + 1
  });
  saveStore();
  addLog(task.id, "info", `Retry queued for ${worker.name}; attempt ${task.attempt}.`);
  auditForTask(task, "user", req.user!.id, "task.retried", `Retry queued from ${original.id}.`, {
    parentTaskId: original.id,
    attempt: task.attempt
  });
  res.status(201).json({ task });
});

app.get("/api/tasks", requireUser, (req: AuthedRequest, res) => {
  recoverStaleRunningTasks();
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const tasks = store.tasks.filter((task) => workspaceIds.includes(task.workspaceId));
  res.json({ tasks });
});

app.get("/api/tasks/:taskId", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const task = store.tasks.find((item) => item.id === req.params.taskId && workspaceIds.includes(item.workspaceId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ task });
});

app.get("/api/tasks/:taskId/logs", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const task = store.tasks.find((item) => item.id === req.params.taskId && workspaceIds.includes(item.workspaceId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const logs = store.logs.filter((log) => log.taskId === task.id);
  res.json({ logs });
});

app.get("/api/tasks/:taskId/artifacts/:artifactId/download", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const task = store.tasks.find((item) => item.id === req.params.taskId && workspaceIds.includes(item.workspaceId));
  const artifactFile = store.artifactFiles.find(
    (item) => item.taskId === req.params.taskId && item.artifactId === req.params.artifactId
  );
  if (!task || !artifactFile || !fs.existsSync(artifactFile.filePath)) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  res.setHeader("Content-Type", artifactFile.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${path.basename(artifactFile.filePath)}"`);
  createReadStream(artifactFile.filePath).pipe(res);
});

app.post("/api/tasks/:taskId/approve", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const task = store.tasks.find((item) => item.id === req.params.taskId && workspaceIds.includes(item.workspaceId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (task.status !== "waiting_user") {
    res.status(400).json({ error: "Task is not waiting for approval" });
    return;
  }

  addLog(task.id, "info", "User approved the paused operation.");
  auditForTask(task, "user", req.user!.id, "task.approval.granted", "User approved a paused operation.", {
    approvalRequest: task.approvalRequest
  });
  updateTask(task, {
    status: "pending",
    approvalGranted: true,
    approvalReason: undefined,
    approvalRequest: undefined
  });
  res.json({ task });
});

app.post("/api/tasks/:taskId/cancel", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const task = store.tasks.find((item) => item.id === req.params.taskId && workspaceIds.includes(item.workspaceId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (isTerminalStatus(task.status)) {
    res.status(400).json({ error: "Task is already finished" });
    return;
  }

  if (task.status === "running") {
    addLog(task.id, "warn", "User requested cancellation. Waiting for worker to interrupt execution.");
    auditForTask(task, "user", req.user!.id, "task.cancel.requested", "User requested task cancellation.");
    updateTask(task, {
      status: "canceling",
      cancelRequestedAt: now()
    });
    res.json({ task });
    return;
  }

  addLog(task.id, "warn", "Task canceled before execution.");
  auditForTask(task, "user", req.user!.id, "task.canceled", "User canceled task before execution.");
  updateTask(task, {
    status: "canceled",
    cancelRequestedAt: now(),
    canceledAt: now(),
    result: "Task canceled before execution."
  });
  res.json({ task });
});

app.get("/api/tasks/:taskId/stream", requireUser, (req: AuthedRequest, res) => {
  const workspaceIds = userWorkspaceIds(req.user!.id);
  const task = store.tasks.find((item) => item.id === req.params.taskId && workspaceIds.includes(item.workspaceId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const send = (event: TaskStreamEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: "task", task });
  for (const log of store.logs.filter((item) => item.taskId === task.id)) {
    send({ type: "log", log });
  }

  const listener = (event: TaskStreamEvent) => send(event);
  events.on(`task:${task.id}`, listener);
  req.on("close", () => events.off(`task:${task.id}`, listener));
});

app.post("/api/worker/register", (req, res) => {
  const pairingToken = assertBodyString(req, "pairingToken");
  const name = assertBodyString(req, "name") || "Local Codex Worker";
  const capabilities = assertCapabilities(req.body?.capabilities);
  const allowedModes = assertAllowedModes(req.body?.allowedModes, capabilities);

  const pairing = store.pairingTokens.find((item) => item.token === pairingToken);
  if (!pairing || pairing.usedAt || Date.parse(pairing.expiresAt) < Date.now()) {
    res.status(401).json({ error: "Invalid or expired pairing token" });
    return;
  }

  const timestamp = now();
  const worker: WorkerRecord = {
    id: id("worker"),
    workspaceId: pairing.workspaceId,
    userId: pairing.userId,
    name,
    status: "online",
    capabilities,
    allowedModes,
    allowedDirectories: assertStringArray(req.body?.allowedDirectories),
    browserProfileDir: optionalBodyString(req, "browserProfileDir"),
    nativeReadiness: assertNativeReadiness(req.body?.nativeReadiness),
    lastSeenAt: timestamp,
    createdAt: timestamp
  };
  const workerToken: WorkerTokenRecord = {
    token: id("wtoken"),
    workerId: worker.id,
    createdAt: timestamp
  };
  pairing.usedAt = timestamp;
  store.workers.push(worker);
  store.workerTokens.push(workerToken);
  addAudit({
    userId: worker.userId,
    actorType: "worker",
    actorId: worker.id,
    action: "worker.registered",
    targetType: "worker",
    targetId: worker.id,
    summary: `${worker.name} registered.`,
    details: {
      capabilities,
      allowedModes,
      allowedDirectories: worker.allowedDirectories,
      browserProfileDir: worker.browserProfileDir,
      nativeReadiness: worker.nativeReadiness
    }
  });
  saveStore();
  res.status(201).json({ workerToken: workerToken.token, worker });
});

app.post("/api/worker/heartbeat", requireWorker, (req: AuthedRequest, res) => {
  const nativeReadiness = assertNativeReadiness(req.body?.nativeReadiness);
  if (nativeReadiness) {
    req.worker!.nativeReadiness = nativeReadiness;
    saveStore();
  }
  res.json({ worker: req.worker });
});

app.get("/api/worker/tasks", requireWorker, (req: AuthedRequest, res) => {
  recoverStaleRunningTasks();
  const task = store.tasks.find((item) => canClaimTask(item, req.worker!.id));
  if (!task) {
    res.json({ task: null });
    return;
  }

  updateTask(task, { status: "running", nextRunAt: undefined });
  addLog(task.id, "info", `${req.worker!.name} claimed the task.`);
  auditForTask(task, "worker", req.worker!.id, "task.claimed", `${req.worker!.name} claimed the task.`);
  res.json({ task });
});

app.get("/api/worker/tasks/:taskId/control", requireWorker, (req: AuthedRequest, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId && item.workerId === req.worker!.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({
    cancelRequested: task.status === "canceling" || Boolean(task.cancelRequestedAt),
    status: task.status
  });
});

app.get("/api/worker/tasks/:taskId/files", requireWorker, (req: AuthedRequest, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId && item.workerId === req.worker!.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const files = task.attachedFileIds.flatMap((fileId) => {
    const file = store.workspaceFiles.find((item) => item.id === fileId && item.workspaceId === task.workspaceId);
    return file ? [publicWorkspaceFile(file)] : [];
  });
  res.json({ files });
});

app.get("/api/worker/tasks/:taskId/files/:fileId/download", requireWorker, (req: AuthedRequest, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId && item.workerId === req.worker!.id);
  const fileId = String(req.params.fileId);
  if (!task || !task.attachedFileIds.includes(fileId)) {
    res.status(404).json({ error: "Task file not found" });
    return;
  }
  const file = store.workspaceFiles.find((item) => item.id === fileId && item.workspaceId === task.workspaceId);
  if (!file?.storagePath || !fs.existsSync(file.storagePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file.name)}"`);
  createReadStream(file.storagePath).pipe(res);
});

app.post("/api/worker/tasks/:taskId/logs", requireWorker, (req: AuthedRequest, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId && item.workerId === req.worker!.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const level = req.body?.level as LogLevel;
  const message = assertBodyString(req, "message");
  addLog(task.id, level || "info", message);
  res.status(201).json({ ok: true });
});

app.post("/api/worker/tasks/:taskId/waiting-approval", requireWorker, (req: AuthedRequest, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId && item.workerId === req.worker!.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const reason = assertBodyString(req, "reason") || "Worker requested approval.";
  const riskClass = typeof req.body?.riskClass === "string" ? req.body.riskClass : "other";
  const action = typeof req.body?.action === "string" ? req.body.action : "manual_approval";
  const command = optionalBodyString(req, "command");
  const workingDirectory = optionalBodyString(req, "workingDirectory");
  const approvalRequest = {
    id: id("approval"),
    reason,
    riskClass,
    action,
    command,
    workingDirectory,
    requestedAt: now()
  };
  addLog(task.id, "warn", reason);
  auditForTask(task, "worker", req.worker!.id, "task.approval.requested", reason, {
    approvalRequest
  });
  updateTask(task, {
    status: "waiting_user",
    approvalReason: reason,
    approvalRequest
  });
  res.json({ task });
});

app.post("/api/worker/tasks/:taskId/complete", requireWorker, (req: AuthedRequest, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId && item.workerId === req.worker!.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const artifacts = persistArtifacts(task, req.body?.artifacts);
  const result = assertBodyString(req, "result") || "Task completed.";
  if (task.status === "canceling") {
    addLog(task.id, "warn", "Worker finished after cancellation had already been requested.");
  }
  addLog(task.id, "info", "Task completed.");
  auditForTask(task, "worker", req.worker!.id, "task.completed", "Task completed.", {
    artifactCount: artifacts.length
  });
  updateTask(task, {
    status: "completed",
    result,
    artifacts
  });
  res.json({ task });
});

app.post("/api/worker/tasks/:taskId/canceled", requireWorker, (req: AuthedRequest, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId && item.workerId === req.worker!.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const result = assertBodyString(req, "result") || "Task canceled by worker.";
  addLog(task.id, "warn", result);
  auditForTask(task, "worker", req.worker!.id, "task.canceled", result);
  updateTask(task, {
    status: "canceled",
    canceledAt: now(),
    result
  });
  res.json({ task });
});

app.post("/api/worker/tasks/:taskId/fail", requireWorker, (req: AuthedRequest, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId && item.workerId === req.worker!.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const error = assertBodyString(req, "error") || "Task failed.";
  addLog(task.id, "error", error);
  auditForTask(task, "worker", req.worker!.id, "task.failed", error);
  updateTask(task, {
    status: "failed",
    error
  });
  res.json({ task });
});

const listenCallback = () => {
  console.log(`CodexBro server listening on ${publicServerUrl}`);
};

if (host) {
  app.listen(port, host, listenCallback);
} else {
  app.listen(port, listenCallback);
}

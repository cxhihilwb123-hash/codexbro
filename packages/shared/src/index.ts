export type TaskMode = "shell" | "codex" | "browser" | "computer";

export type BrowserSessionMode = "persistent" | "ephemeral";

export type TaskStatus =
  | "pending"
  | "running"
  | "waiting_user"
  | "canceling"
  | "canceled"
  | "completed"
  | "failed";

export type LogLevel = "info" | "warn" | "error" | "stdout" | "stderr";

export type WorkerCapability = "shell" | "codex" | "browser" | "computer";

export type AuditActorType = "user" | "worker" | "system";

export type WorkspaceRole = "owner" | "admin" | "operator" | "viewer";

export type PlatformRole = "admin" | "user";

export interface WorkerReadinessCheck {
  ok: boolean;
  detail: string;
  checkedAt: string;
  status?: "ready" | "available" | "warning" | "unavailable";
}

export interface WorkerNativeReadiness {
  backend: "desktop" | "app-server" | "exec";
  codexCli: WorkerReadinessCheck;
  codexAppServer?: WorkerReadinessCheck;
  codexDesktopBridge?: WorkerReadinessCheck;
  codexDesktopSmoke?: WorkerReadinessCheck;
  cuaDriver?: WorkerReadinessCheck;
  chrome?: WorkerReadinessCheck;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
}

export interface WorkspaceMemberRecord {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}

export type ApprovalRiskClass = "destructive" | "privileged" | "network_pipe" | "filesystem" | "other";

export interface TaskApprovalRequest {
  id: string;
  reason: string;
  riskClass: ApprovalRiskClass;
  action: string;
  command?: string;
  workingDirectory?: string;
  requestedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  platformRole: PlatformRole;
  disabledAt?: string;
  createdAt: string;
}

export interface WorkerRecord {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  status: "online" | "offline";
  capabilities: WorkerCapability[];
  allowedModes: TaskMode[];
  allowedDirectories: string[];
  browserProfileDir?: string;
  nativeReadiness?: WorkerNativeReadiness;
  lastSeenAt: string;
  createdAt: string;
}

export interface TaskArtifact {
  id: string;
  name: string;
  type: "text" | "file" | "url";
  value: string;
  createdAt: string;
}

export interface WorkspaceFileRecord {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  mimeType: string;
  size: number;
  storagePath?: string;
  createdAt: string;
}

export interface WorkspacePromptTemplateRecord {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  description: string;
  prompt: string;
  mode: TaskMode;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  workspaceId: string;
  userId: string;
  workerId: string;
  title: string;
  prompt: string;
  mode: TaskMode;
  browserSessionMode?: BrowserSessionMode;
  workingDirectory?: string;
  attachedFileIds: string[];
  idempotencyKey?: string;
  parentTaskId?: string;
  attempt: number;
  nextRunAt?: string;
  status: TaskStatus;
  approvalGranted: boolean;
  approvalReason?: string;
  approvalRequest?: TaskApprovalRequest;
  cancelRequestedAt?: string;
  canceledAt?: string;
  result?: string;
  error?: string;
  artifacts: TaskArtifact[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskLogRecord {
  id: string;
  taskId: string;
  level: LogLevel;
  message: string;
  createdAt: string;
}

export interface AuditEventRecord {
  id: string;
  userId: string;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  targetType: "auth" | "worker" | "task" | "artifact" | "settings" | "user" | "workspace" | "prompt_template";
  targetId?: string;
  summary: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface AdminWorkspaceSummary extends WorkspaceRecord {
  memberCount: number;
}

export interface AdminUserSummary extends UserProfile {
  workspaces: Array<WorkspaceRecord & { role: WorkspaceRole }>;
}

export interface AdminUsersResponse {
  users: AdminUserSummary[];
  workspaces: AdminWorkspaceSummary[];
}

export interface PairingTokenResponse {
  pairingToken: string;
  expiresAt: string;
  command: string;
  desktopCommand?: string;
  recommendedCommand?: string;
  workspaceId: string;
}

export interface WorkerRegisterResponse {
  workerToken: string;
  worker: WorkerRecord;
}

export interface WorkerTaskResponse {
  task: TaskRecord | null;
}

export interface WorkerTaskControlResponse {
  cancelRequested: boolean;
  status: TaskStatus;
}

export interface TaskStreamEvent {
  type: "task" | "log";
  task?: TaskRecord;
  log?: TaskLogRecord;
}

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { CodexAppServerClient, type CodexAppServerClientHandlers, type CodexAppServerMessage } from "./codex-app-server.js";
import type {
  LogLevel,
  TaskMode,
  TaskArtifact,
  TaskRecord,
  WorkspaceFileRecord,
  WorkerCapability,
  WorkerNativeReadiness,
  WorkerRegisterResponse,
  WorkerTaskControlResponse,
  WorkerTaskResponse
} from "@codexbro/shared";

interface CliOptions {
  server: string;
  pairingToken?: string;
  workerToken?: string;
  name: string;
  allowedDirectories: string[];
  allowedModes: TaskMode[];
  browserProfileDir: string;
  tokenFile: string;
}

interface TaskWorkspace {
  rootDir: string;
  inputDir: string;
  outputDir: string;
  scratchDir: string;
  inputFiles: Array<{ id: string; name: string; path: string; mimeType: string; size: number }>;
}

const dangerousPatterns = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bchmod\s+-R\b/,
  /\bchown\s+-R\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /curl\b.+\|\s*(sh|bash)/,
  /wget\b.+\|\s*(sh|bash)/
];

const capabilities: WorkerCapability[] = ["shell", "codex", "browser", "computer"];
const taskModes: TaskMode[] = ["shell", "codex", "browser", "computer"];
const defaultCuaDriverBin = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const defaultChromeSkillRoot = path.join(os.homedir(), ".codex/plugins/cache/openai-bundled/chrome/26.601.21317");
const defaultArtifactMaxFiles = 20;
const defaultArtifactMaxBytes = 25 * 1024 * 1024;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const persisted = await readPersistedWorkerToken(options);
  if (!options.workerToken && persisted) {
    options.workerToken = persisted.workerToken;
    console.log(`Loaded worker token for ${persisted.workerName ?? persisted.workerId} from ${options.tokenFile}`);
  }
  currentAllowedDirectories = options.allowedDirectories;
  let nativeReadiness = await collectWorkerNativeReadiness(options);
  let nativeReadinessCheckedAt = Date.now();
  logNativeReadinessToConsole(nativeReadiness);
  let workerToken = options.workerToken;

  if (!workerToken && options.pairingToken) {
    const registered = await register(options, nativeReadiness);
    workerToken = registered.workerToken;
    await writePersistedWorkerToken(options, registered);
    console.log(`Registered worker ${registered.worker.name}`);
    console.log(`Worker token saved to ${options.tokenFile}`);
  }

  if (!workerToken) {
    throw new Error("Provide --pairing-token for first registration or --worker-token for an existing worker.");
  }

  console.log(`CodexBro worker connected to ${options.server}`);
  await loop(options, workerToken, async () => {
    const refreshMs = Number(process.env.CODEXBRO_NATIVE_READINESS_REFRESH_MS ?? 60000);
    if (Date.now() - nativeReadinessCheckedAt >= refreshMs) {
      nativeReadiness = await collectWorkerNativeReadiness(options);
      nativeReadinessCheckedAt = Date.now();
    }
    return nativeReadiness;
  });
}

function parseArgs(args: string[]): CliOptions {
  const launchDirectory = process.env.CODEXBRO_WORKER_LAUNCH_DIR ?? process.env.INIT_CWD ?? process.cwd();
  const options: CliOptions = {
    server: process.env.CODEXBRO_SERVER ?? "http://localhost:4317",
    pairingToken: process.env.CODEXBRO_PAIRING_TOKEN,
    workerToken: process.env.CODEXBRO_WORKER_TOKEN,
    name: process.env.CODEXBRO_WORKER_NAME ?? `${os.hostname()} Codex Worker`,
    allowedDirectories: parseAllowedDirectories(process.env.CODEXBRO_ALLOWED_DIRS),
    allowedModes: parseAllowedModes(process.env.CODEXBRO_ALLOWED_MODES),
    browserProfileDir: process.env.CODEXBRO_BROWSER_PROFILE_DIR ?? path.join(process.cwd(), ".codexbro", "browser-profile"),
    tokenFile: resolveLaunchPath(process.env.CODEXBRO_WORKER_TOKEN_FILE ?? path.join(".codexbro", "worker-token.json"), launchDirectory)
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--server" && next) {
      options.server = next;
      index += 1;
    } else if (arg === "--pairing-token" && next) {
      options.pairingToken = next;
      index += 1;
    } else if (arg === "--worker-token" && next) {
      options.workerToken = next;
      index += 1;
    } else if (arg === "--name" && next) {
      options.name = next;
      index += 1;
    } else if (arg === "--allowed-dir" && next) {
      options.allowedDirectories.push(path.resolve(next));
      index += 1;
    } else if (arg === "--allowed-mode" && next) {
      if (isTaskMode(next)) options.allowedModes.push(next);
      index += 1;
    } else if (arg === "--browser-profile-dir" && next) {
      options.browserProfileDir = path.resolve(next);
      index += 1;
    } else if (arg === "--token-file" && next) {
      options.tokenFile = resolveLaunchPath(next, launchDirectory);
      index += 1;
    }
  }

  if (!options.allowedDirectories.length) {
    options.allowedDirectories.push(process.cwd());
  }
  options.allowedDirectories = Array.from(new Set(options.allowedDirectories.map((dir) => path.resolve(dir))));
  options.allowedModes = Array.from(new Set(options.allowedModes));
  if (!options.allowedModes.length) options.allowedModes = ["shell", "codex", "browser", "computer"];
  return options;
}

function resolveLaunchPath(value: string, launchDirectory: string) {
  return path.isAbsolute(value) ? value : path.resolve(launchDirectory, value);
}

async function readPersistedWorkerToken(options: CliOptions) {
  try {
    const parsed = JSON.parse(await readFile(options.tokenFile, "utf8")) as {
      server?: unknown;
      workerToken?: unknown;
      workerId?: unknown;
      workerName?: unknown;
    };
    if (typeof parsed.workerToken !== "string") return undefined;
    if (typeof parsed.server === "string" && normalizeServer(parsed.server) !== normalizeServer(options.server)) {
      return undefined;
    }
    return {
      workerToken: parsed.workerToken,
      workerId: typeof parsed.workerId === "string" ? parsed.workerId : "saved-worker",
      workerName: typeof parsed.workerName === "string" ? parsed.workerName : undefined
    };
  } catch {
    return undefined;
  }
}

async function writePersistedWorkerToken(options: CliOptions, registered: WorkerRegisterResponse) {
  await mkdir(path.dirname(options.tokenFile), { recursive: true });
  await writeFile(options.tokenFile, JSON.stringify({
    server: options.server,
    workerToken: registered.workerToken,
    workerId: registered.worker.id,
    workerName: registered.worker.name,
    workspaceId: registered.worker.workspaceId,
    savedAt: new Date().toISOString()
  }, null, 2));
  await chmod(options.tokenFile, 0o600).catch(() => undefined);
}

function normalizeServer(server: string) {
  return server.replace(/\/+$/, "");
}

function parseAllowedDirectories(value: string | undefined) {
  if (!value) return [];
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function parseAllowedModes(value: string | undefined): TaskMode[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(isTaskMode);
}

function isTaskMode(value: string): value is TaskMode {
  return taskModes.includes(value as TaskMode);
}

async function register(options: CliOptions, nativeReadiness: WorkerNativeReadiness) {
  return api<WorkerRegisterResponse>(options.server, "/api/worker/register", {
    method: "POST",
    body: {
      pairingToken: options.pairingToken,
      name: options.name,
      capabilities,
      allowedModes: options.allowedModes,
      allowedDirectories: options.allowedDirectories,
      browserProfileDir: options.browserProfileDir,
      nativeReadiness
    }
  });
}

async function loop(options: CliOptions, initialWorkerToken: string, readiness: () => Promise<WorkerNativeReadiness>) {
  let workerToken = initialWorkerToken;
  let pairingRetryAttempted = false;

  for (;;) {
    try {
      await api(options.server, "/api/worker/heartbeat", {
        method: "POST",
        workerToken,
        body: {
          nativeReadiness: await readiness()
        }
      });
      const response = await api<WorkerTaskResponse>(options.server, "/api/worker/tasks", {
        workerToken
      });
      if (response.task) {
        await runTaskWithHeartbeat(options.server, workerToken, response.task);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && options.pairingToken && !pairingRetryAttempted) {
        pairingRetryAttempted = true;
        console.error("Saved worker token was rejected by the server; trying the provided pairing token.");
        try {
          const registered = await register(options, await readiness());
          workerToken = registered.workerToken;
          await writePersistedWorkerToken(options, registered);
          console.log(`Re-registered worker ${registered.worker.name}`);
          console.log(`Worker token saved to ${options.tokenFile}`);
          continue;
        } catch (registerError) {
          console.error(registerError instanceof Error ? registerError.message : String(registerError));
        }
      }
      console.error(error instanceof Error ? error.message : String(error));
    }
    await wait(2000);
  }
}

async function runTaskWithHeartbeat(server: string, workerToken: string, task: TaskRecord) {
  const heartbeat = setInterval(() => {
    void api(server, "/api/worker/heartbeat", {
      method: "POST",
      workerToken
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
  }, 5000);

  try {
    await runTask(server, workerToken, task);
  } finally {
    clearInterval(heartbeat);
  }
}

async function runTask(server: string, workerToken: string, task: TaskRecord) {
  await log(server, workerToken, task.id, "info", `Starting ${task.mode} task: ${task.title}`);

  try {
    if (task.mode === "shell") {
      await runShellTask(server, workerToken, task);
      return;
    }

    if (task.mode === "codex") {
      await runCodexTask(server, workerToken, task);
      return;
    }

    if (task.mode === "browser") {
      await runBrowserTask(server, workerToken, task);
      return;
    }

    await runComputerTask(server, workerToken, task);
  } catch (error) {
    await fail(server, workerToken, task.id, error instanceof Error ? error.message : String(error));
  }
}

async function runShellTask(server: string, workerToken: string, task: TaskRecord) {
  const command = task.prompt.trim();
  const workingDirectory = resolveWorkingDirectory(task);
  if (!workingDirectory.allowed) {
    await fail(server, workerToken, task.id, workingDirectory.reason);
    return;
  }
  const attachedFiles = await getAttachedFiles(server, workerToken, task);
  const taskWorkspace = await prepareTaskWorkspace(server, workerToken, task, attachedFiles, workingDirectory.cwd);

  const approvalRisk = classifyApprovalRisk(command);
  if (!task.approvalGranted && approvalRisk) {
    await api(server, `/api/worker/tasks/${task.id}/waiting-approval`, {
      method: "POST",
      workerToken,
      body: {
        reason: `Command requires approval before running: ${command}`,
        riskClass: approvalRisk,
        action: "shell.command",
        command,
        workingDirectory: taskWorkspace.rootDir
      }
    });
    return;
  }

  const result = await runProcess(server, workerToken, task.id, command, [], {
    shell: true,
    cwd: taskWorkspace.rootDir,
    env: taskEnvironment(server, workerToken, task, attachedFiles, taskWorkspace)
  });
  if (result.canceled) {
    await canceled(server, workerToken, task.id, "Shell task canceled and process interrupted.");
    return;
  }
  if (result.code === 0) {
    const artifacts = await collectTaskArtifacts(taskWorkspace.outputDir);
    await complete(server, workerToken, task.id, result.output || "Command completed successfully.", artifacts);
  } else {
    await fail(server, workerToken, task.id, `Command exited with code ${result.code}.`);
  }
}

async function runCodexTask(server: string, workerToken: string, task: TaskRecord) {
  await runCodexExecTask(server, workerToken, task, task.prompt, "Codex");
}

async function runCodexBrowserTask(server: string, workerToken: string, task: TaskRecord) {
  await runCodexExecTask(server, workerToken, task, codexNativeToolPrompt(task.prompt, "browser"), "Codex Browser plugin", "browser");
}

async function runCodexComputerTask(server: string, workerToken: string, task: TaskRecord) {
  await runCodexExecTask(server, workerToken, task, codexNativeToolPrompt(task.prompt, "computer"), "Codex Computer Use", "computer");
}

async function runCodexExecTask(
  server: string,
  workerToken: string,
  task: TaskRecord,
  promptBody: string,
  label: string,
  requiredNativeTool?: "browser" | "computer"
) {
  const workingDirectory = resolveWorkingDirectory(task);
  if (!workingDirectory.allowed) {
    await fail(server, workerToken, task.id, workingDirectory.reason);
    return;
  }
  const attachedFiles = await getAttachedFiles(server, workerToken, task);
  const taskWorkspace = await prepareTaskWorkspace(server, workerToken, task, attachedFiles, workingDirectory.cwd);
  const prompt = withTaskContext(promptBody, server, task, attachedFiles, taskWorkspace);

  await log(server, workerToken, task.id, "info", `Delegating task to ${label} via codex exec.`);
  const result = await runProcess(server, workerToken, task.id, process.env.CODEXBRO_CODEX_BIN ?? "codex", ["exec", prompt], {
    shell: false,
    cwd: taskWorkspace.rootDir,
    env: taskEnvironment(server, workerToken, task, attachedFiles, taskWorkspace)
  });
  if (result.canceled) {
    await canceled(server, workerToken, task.id, `${label} task canceled and process interrupted.`);
    return;
  }
  const unavailable = requiredNativeTool ? nativeToolUnavailableMessage(result.output, requiredNativeTool) : undefined;
  if (unavailable) {
    await fail(server, workerToken, task.id, unavailable);
    return;
  }
  if (result.code === 0) {
    const artifacts = await collectTaskArtifacts(taskWorkspace.outputDir);
    await complete(server, workerToken, task.id, result.output || `${label} task completed.`, artifacts);
  } else {
    await fail(server, workerToken, task.id, `${label} exited with code ${result.code}.`);
  }
}

async function runBrowserTask(server: string, workerToken: string, task: TaskRecord) {
  if (nativeTaskBackend() === "exec") {
    await runCodexBrowserTask(server, workerToken, task);
    return;
  }
  if (nativeTaskBackend() === "app-server") {
    await runCodexAppServerNativeTask(server, workerToken, task, "browser");
    return;
  }
  await runCodexDesktopTask(server, workerToken, task, "browser");
}

async function runComputerTask(server: string, workerToken: string, task: TaskRecord) {
  if (nativeTaskBackend() === "exec") {
    await runCodexComputerTask(server, workerToken, task);
    return;
  }
  if (nativeTaskBackend() === "app-server") {
    await runCodexAppServerNativeTask(server, workerToken, task, "computer");
    return;
  }
  await runCodexDesktopTask(server, workerToken, task, "computer");
}

function nativeTaskBackend() {
  const configured = process.env.CODEXBRO_NATIVE_TASK_BACKEND;
  if (configured === "desktop" || configured === "exec" || configured === "app-server") return configured;
  return process.env.CODEXBRO_CODEX_BIN ? "exec" : "desktop";
}

async function collectWorkerNativeReadiness(options: CliOptions): Promise<WorkerNativeReadiness> {
  const cwd = options.allowedDirectories[0] ?? process.cwd();
  const backend = nativeTaskBackend();
  const codexCommand = process.env.CODEXBRO_CODEX_BIN ?? "codex";
  const appServerCommand = process.env.CODEXBRO_APP_SERVER_CODEX_BIN ?? process.env.CODEXBRO_CODEX_BIN ?? "codex";
  const [
    codexCli,
    codexAppServer,
    codexDesktopBridge,
    codexDesktopSmoke,
    cuaDriver,
    chrome
  ] = await Promise.all([
    readinessCommand(`${codexCommand} --version`, () => runQuiet(codexCommand, ["--version"], cwd)),
    readinessCommand(`${appServerCommand} app-server --help`, () => runQuiet(appServerCommand, ["app-server", "--help"], cwd)),
    inspectCodexDesktopBridgeReadiness(cwd),
    inspectCodexDesktopSmokeReadiness(cwd),
    inspectCuaDriverReadiness(cwd),
    inspectChromeReadiness(cwd)
  ]);

  return {
    backend,
    codexCli,
    codexAppServer,
    codexDesktopBridge,
    ...(codexDesktopSmoke ? { codexDesktopSmoke } : {}),
    cuaDriver,
    chrome
  };
}

async function readinessCommand(label: string, run: () => Promise<string>) {
  const checkedAt = new Date().toISOString();
  try {
    const output = await run();
    return {
      ok: true,
      detail: `${label}: ${(output || "ok").split(/\r?\n/)[0].slice(0, 180)}`,
      checkedAt,
      status: "ready" as const
    };
  } catch (error) {
    return {
      ok: false,
      detail: `${label}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      checkedAt,
      status: "unavailable" as const
    };
  }
}

async function inspectCodexDesktopBridgeReadiness(cwd: string) {
  const checkedAt = new Date().toISOString();
  try {
    const script = await resolveCodexDesktopBridgeScript(cwd);
    const scriptExists = await fileExists(script);
    const platformOk = process.platform === "darwin";
    if (platformOk && scriptExists && process.env.CODEXBRO_DESKTOP_BRIDGE_DIAGNOSE_READINESS === "true") {
      const diagnose = await runJsonCommand(process.execPath, [script, "diagnose", "--cwd", cwd], cwd);
      const report = diagnose.json && typeof diagnose.json === "object" ? diagnose.json as {
        ok?: unknown;
        selectedWindow?: { windowId?: unknown };
        snapshot?: { elementCount?: unknown; hasNewChat?: unknown; hasTextInput?: unknown; hasSendButton?: unknown };
      } : undefined;
      const ok = diagnose.code === 0 && report?.ok === true;
      const detail = report
        ? `platform=${process.platform} script=${script} scriptExists=${scriptExists} diagnose=true windowId=${String(report.selectedWindow?.windowId ?? "none")} elementCount=${String(report.snapshot?.elementCount ?? "unknown")} hasNewChat=${Boolean(report.snapshot?.hasNewChat)} hasTextInput=${Boolean(report.snapshot?.hasTextInput)} hasSendButton=${Boolean(report.snapshot?.hasSendButton)} submitSmoke=not-run`
        : `platform=${process.platform} script=${script} scriptExists=${scriptExists} diagnose=true error=${(diagnose.stderr || diagnose.stdout || `exit ${diagnose.code}`).slice(0, 160)} submitSmoke=not-run`;
      return {
        ok,
        detail,
        checkedAt,
        status: ok ? "ready" as const : "warning" as const
      };
    }
    return {
      ok: platformOk && scriptExists,
      detail: `platform=${process.platform} script=${script} scriptExists=${scriptExists} submitSmoke=not-run`,
      checkedAt,
      status: platformOk && scriptExists ? "available" as const : "unavailable" as const
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      checkedAt,
      status: "unavailable" as const
    };
  }
}

async function inspectCodexDesktopSmokeReadiness(cwd: string) {
  if (process.env.CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS !== "true") return undefined;

  const checkedAt = new Date().toISOString();
  if (process.platform !== "darwin") {
    return {
      ok: false,
      detail: `submitSmoke=skipped platform=${process.platform}`,
      checkedAt,
      status: "unavailable" as const
    };
  }
  if (process.env.CODEXBRO_DESKTOP_ALLOW_FOREGROUND !== "true") {
    return {
      ok: false,
      detail: "submitSmoke=skipped requires CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true",
      checkedAt,
      status: "warning" as const
    };
  }

  try {
    const script = await resolveCodexDesktopBridgeScript(cwd);
    const marker = `CODEXBRO_DESKTOP_READINESS_${Date.now()}`;
    const doneMarker = `${marker}_DONE`;
    const resultFile = path.join(cwd, ".codexbro", "desktop-readiness", `${marker}.md`);
    const configuredTimeoutMs = Number(process.env.CODEXBRO_DESKTOP_BRIDGE_SMOKE_TIMEOUT_MS ?? 180000);
    const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : 180000;
    const prompt = [
      `${marker} This is a CodexBro Desktop bridge readiness smoke test.`,
      `Create ${resultFile} containing exactly ${doneMarker} and no other text.`,
      "Do not do anything else."
    ].join(" ");
    const submit = await runJsonCommandWithTimeout(process.execPath, [
      script,
      "submit",
      "--cwd",
      cwd,
      "--prompt",
      prompt,
      "--marker",
      marker,
      "--done-marker",
      doneMarker,
      "--result-file",
      resultFile,
      "--timeout-ms",
      String(timeoutMs),
      "--poll-ms",
      process.env.CODEXBRO_DESKTOP_BRIDGE_SMOKE_POLL_MS ?? "5000"
    ], cwd, timeoutMs + 10000);
    const report = submit.json && typeof submit.json === "object" ? submit.json as {
      ok?: unknown;
      durationMs?: unknown;
      result?: unknown;
      resultFileExists?: unknown;
      error?: unknown;
    } : undefined;
    const ok = submit.code === 0 && report?.ok === true && typeof report.result === "string" && report.result.includes(doneMarker);
    return {
      ok,
      detail: ok
        ? `submitSmoke=passed durationMs=${String(report?.durationMs ?? "unknown")} resultFileExists=${Boolean(report?.resultFileExists)}`
        : `submitSmoke=failed exit=${String(submit.code)} ${String(report?.error ?? (submit.stderr || submit.stdout)).slice(0, 220)}`,
      checkedAt,
      status: ok ? "ready" as const : "warning" as const
    };
  } catch (error) {
    return {
      ok: false,
      detail: `submitSmoke=failed ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      checkedAt,
      status: "warning" as const
    };
  }
}

async function inspectCuaDriverReadiness(cwd: string) {
  const command = cuaDriverCommand();
  const checkedAt = new Date().toISOString();
  try {
    const version = (await runQuiet(command, ["--version"], cwd)).split(/\r?\n/)[0] || "unknown";
    const permissions = await runQuiet(command, ["call", "check_permissions", JSON.stringify({ prompt: false })], cwd);
    const accessibilityGranted = /Accessibility:\s*granted/i.test(permissions);
    const screenRecordingGranted = /Screen Recording:\s*granted/i.test(permissions);
    const apps = await runJsonCommand(command, ["call", "list_apps", "{}"], cwd);
    const appCount = apps.code === 0 && apps.json && typeof apps.json === "object" && Array.isArray((apps.json as { apps?: unknown }).apps)
      ? ((apps.json as { apps: unknown[] }).apps).length
      : 0;
    return {
      ok: accessibilityGranted && screenRecordingGranted && appCount > 0,
      detail: `bin=${command} version=${version} accessibilityGranted=${accessibilityGranted} screenRecordingGranted=${screenRecordingGranted} appCount=${appCount}`,
      checkedAt,
      status: accessibilityGranted && screenRecordingGranted && appCount > 0 ? "ready" as const : "unavailable" as const
    };
  } catch (error) {
    return {
      ok: false,
      detail: `bin=${command} ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      checkedAt,
      status: "unavailable" as const
    };
  }
}

async function inspectChromeReadiness(cwd: string) {
  const checkedAt = new Date().toISOString();
  const chromeRoot = process.env.CODEXBRO_CHROME_SKILL_ROOT ?? defaultChromeSkillRoot;
  const scripts = {
    running: path.join(chromeRoot, "scripts", "chrome-is-running.js"),
    installed: path.join(chromeRoot, "scripts", "check-extension-installed.js"),
    manifest: path.join(chromeRoot, "scripts", "check-native-host-manifest.js")
  };
  try {
    if (!await fileExists(scripts.running) || !await fileExists(scripts.installed) || !await fileExists(scripts.manifest)) {
      return {
        ok: false,
        detail: `Chrome skill scripts missing under ${chromeRoot}`,
        checkedAt,
        status: "unavailable" as const
      };
    }
    const [running, installed, manifest] = await Promise.all([
      runJsonCommand(process.execPath, [scripts.running, "--json"], cwd),
      runJsonCommand(process.execPath, [scripts.installed, "--json"], cwd),
      runJsonCommand(process.execPath, [scripts.manifest, "--json"], cwd)
    ]);
    const chromeRunning = Boolean(readBooleanProperty(running.json, "running"));
    const extensionInstalled = Boolean(readBooleanProperty(installed.json, "installed"));
    const extensionEnabled = Boolean(readBooleanProperty(installed.json, "enabled"));
    const nativeHostCorrect = Boolean(readBooleanProperty(manifest.json, "correct"));
    const profile = readStringProperty(installed.json, "selectedProfileDirectory");
    return {
      ok: chromeRunning && extensionInstalled && extensionEnabled && nativeHostCorrect,
      detail: [
        `running=${chromeRunning}`,
        `extensionInstalled=${extensionInstalled}`,
        `extensionEnabled=${extensionEnabled}`,
        `nativeHostCorrect=${nativeHostCorrect}`,
        profile ? `profile=${profile}` : ""
      ].filter(Boolean).join(" "),
      checkedAt,
      status: chromeRunning && extensionInstalled && extensionEnabled && nativeHostCorrect ? "ready" as const : "unavailable" as const
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      checkedAt,
      status: "unavailable" as const
    };
  }
}

function logNativeReadinessToConsole(readiness: WorkerNativeReadiness) {
  console.log(`Native backend: ${readiness.backend}`);
  for (const [label, check] of Object.entries({
    codexCli: readiness.codexCli,
    codexAppServer: readiness.codexAppServer,
    codexDesktopBridge: readiness.codexDesktopBridge,
    codexDesktopSmoke: readiness.codexDesktopSmoke,
    cuaDriver: readiness.cuaDriver,
    chrome: readiness.chrome
  })) {
    if (!check) continue;
    console.log(`Native readiness ${label}: ${check.status ?? (check.ok ? "ready" : "unavailable")} - ${check.detail}`);
  }
}

interface SkillsListResult {
  data?: Array<{
    cwd: string;
    skills?: Array<{
      name: string;
      description?: string;
      path?: string;
      enabled?: boolean;
    }>;
    errors?: string[];
  }>;
}

interface AppListResult {
  data?: Array<{
    id?: string;
    name?: string;
    isEnabled?: boolean;
    isAccessible?: boolean;
  }>;
}

interface ThreadStartResult {
  thread?: {
    id?: string;
    status?: unknown;
  };
}

interface TurnStartResult {
  turn?: {
    id?: string;
  };
}

type CodexUserInput =
  | { type: "text"; text: string; text_elements: unknown[] }
  | { type: "skill"; name: string; path: string };

interface NativeRuntimeDiagnostics {
  lines: string[];
  chromeReady?: boolean;
  browserUseRuntimeReady?: boolean;
  browserUseRuntimeDetail?: string;
  cuaDriverReady?: boolean;
  cuaDriverDetail?: string;
}

interface BrowserRuntimeProbeResult {
  ready?: boolean;
  line?: string;
  detail?: string;
}

interface CodexAppServerLease {
  key: string;
  client: CodexAppServerClient;
  reused: boolean;
}

const appServerPool = new Map<string, { client: CodexAppServerClient; active: boolean; idleTimer?: NodeJS.Timeout }>();

function acquireCodexAppServerClient(input: {
  command: string;
  args: string[];
  cwd: string;
  requestTimeoutMs: number;
  handlers: CodexAppServerClientHandlers;
}): CodexAppServerLease {
  const reusable = appServerReuseEnabled();
  const key = codexAppServerPoolKey(input.command, input.args, input.cwd);
  if (reusable) {
    const existing = appServerPool.get(key);
    if (existing?.client.isRunning() && !existing.active) {
      if (existing.idleTimer) clearTimeout(existing.idleTimer);
      existing.active = true;
      existing.client.setHandlers(input.handlers);
      return { key, client: existing.client, reused: true };
    }
  }

  const client = new CodexAppServerClient({
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    requestTimeoutMs: input.requestTimeoutMs,
    ...input.handlers
  });
  if (reusable) {
    appServerPool.set(key, { client, active: true });
  }
  return { key, client, reused: false };
}

function releaseCodexAppServerClient(lease: CodexAppServerLease) {
  const entry = appServerPool.get(lease.key);
  if (!entry || entry.client !== lease.client) {
    lease.client.destroy();
    return;
  }
  entry.active = false;
  entry.client.setHandlers({});
  if (!appServerReuseEnabled()) {
    appServerPool.delete(lease.key);
    entry.client.destroy();
    return;
  }
  const idleMs = Number(process.env.CODEXBRO_APP_SERVER_IDLE_MS ?? 300000);
  if (idleMs <= 0) return;
  entry.idleTimer = setTimeout(() => {
    const current = appServerPool.get(lease.key);
    if (!current || current.active) return;
    appServerPool.delete(lease.key);
    current.client.destroy();
  }, idleMs);
  entry.idleTimer.unref();
}

function destroyCodexAppServerPool() {
  for (const entry of appServerPool.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.client.destroy();
  }
  appServerPool.clear();
}

function appServerReuseEnabled() {
  return process.env.CODEXBRO_APP_SERVER_REUSE !== "false";
}

function codexAppServerPoolKey(command: string, args: string[], cwd: string) {
  return JSON.stringify({ command, args, cwd });
}

async function runCodexAppServerNativeTask(
  server: string,
  workerToken: string,
  task: TaskRecord,
  tool: "browser" | "computer"
) {
  const workingDirectory = resolveWorkingDirectory(task);
  if (!workingDirectory.allowed) {
    await fail(server, workerToken, task.id, workingDirectory.reason);
    return;
  }

  const attachedFiles = await getAttachedFiles(server, workerToken, task);
  const taskWorkspace = await prepareTaskWorkspace(server, workerToken, task, attachedFiles, workingDirectory.cwd);
  const codexCommand = process.env.CODEXBRO_APP_SERVER_CODEX_BIN ?? process.env.CODEXBRO_CODEX_BIN ?? "codex";
  const timeoutMs = Number(process.env.CODEXBRO_APP_SERVER_TIMEOUT_MS ?? 900000);
  const requestTimeoutMs = Number(process.env.CODEXBRO_APP_SERVER_REQUEST_TIMEOUT_MS ?? 45000);
  const approvalPolicy = optionalEnv("CODEXBRO_APP_SERVER_APPROVAL_POLICY");
  const sandbox = optionalEnv("CODEXBRO_APP_SERVER_SANDBOX");
  const model = optionalEnv("CODEXBRO_APP_SERVER_MODEL");
  const effort = optionalEnv("CODEXBRO_APP_SERVER_EFFORT");
  const ephemeral = process.env.CODEXBRO_APP_SERVER_EPHEMERAL !== "false";
  const appServerArgs = codexAppServerArgs({ approvalPolicy, sandbox });
  let threadId: string | undefined;
  let activeTurnId: string | undefined;
  let turnCompleted = false;
  let turnStatus = "";
  let turnError = "";
  let agentText = "";
  let didCancel = false;
  let resolveTurn: (() => void) | undefined;
  const turnDone = new Promise<void>((resolve) => {
    resolveTurn = resolve;
  });

  const handlers: CodexAppServerClientHandlers = {
    onStderr: (text) => {
      for (const line of splitLogLines(text)) {
        void log(server, workerToken, task.id, "stderr", `[codex app-server] ${line}`);
      }
    },
    onNotification: (message) => {
      const summary = summarizeCodexAppServerNotification(message);
      if (summary) void log(server, workerToken, task.id, "stdout", summary);

      if (message.method === "turn/started") {
        activeTurnId = readNestedString(message.params, ["turn", "id"]) ?? activeTurnId;
      }
      if (message.method === "item/agentMessage/delta") {
        const delta = readStringProperty(message.params, "delta");
        if (delta) agentText += delta;
      }
      if (message.method === "turn/completed") {
        turnCompleted = true;
        turnStatus = readNestedString(message.params, ["turn", "status"]) ?? "completed";
        turnError = readNestedString(message.params, ["turn", "error", "message"]) ?? "";
        resolveTurn?.();
      }
    },
    onServerRequest: (message) => handleCodexAppServerRequest(server, workerToken, task, workingDirectory.cwd, message)
  };
  const lease = acquireCodexAppServerClient({
    command: codexCommand,
    args: appServerArgs,
    cwd: workingDirectory.cwd,
    requestTimeoutMs,
    handlers
  });
  const client = lease.client;

  const cancelTimer = setInterval(() => {
    void getControl(server, workerToken, task.id).then(async (control) => {
      if (!control.cancelRequested || didCancel) return;
      didCancel = true;
      await log(server, workerToken, task.id, "warn", "Cancellation received. Interrupting Codex app-server turn.");
      if (threadId && activeTurnId) {
        await client.request("turn/interrupt", { threadId, turnId: activeTurnId }).catch((error) => {
          void log(server, workerToken, task.id, "warn", `Could not interrupt Codex turn cleanly: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      resolveTurn?.();
    }).catch(() => undefined);
  }, 1000);

  try {
    await log(server, workerToken, task.id, `info`, `Delegating ${tool} task to Codex app-server backend.`);
    await log(server, workerToken, task.id, "info", `${lease.reused ? "Reusing" : "Starting"} ${codexCommand} ${appServerArgs.join(" ")}.`);
    await client.start();
    const skillsResult = await client.request<SkillsListResult>("skills/list", {
      cwds: [taskWorkspace.rootDir],
      forceReload: true
    });
    const skills = flattenCodexSkills(skillsResult);
    const relevantSkills = relevantNativeSkills(skills, tool);
    await log(server, workerToken, task.id, "info", `Codex app-server exposed ${skills.length} skills. Relevant ${tool} skills: ${relevantSkills.map((skill) => skill.name).join(", ") || "none"}.`);
    await logAppListBestEffort(client, server, workerToken, task.id);
    const diagnostics = await inspectNativeRuntimeDiagnostics(tool, relevantSkills, taskWorkspace.rootDir);
    for (const line of diagnostics.lines) {
      const diagnosticWarn =
        (diagnostics.chromeReady === false && line.includes("Chrome")) ||
        (diagnostics.cuaDriverReady === false && line.includes("CuaDriver"));
      await log(server, workerToken, task.id, diagnosticWarn ? "warn" : "info", line);
    }

    const unavailable = preflightNativeSkillUnavailable(tool, skills);
    if (unavailable) {
      await failOrFallbackFromAppServerNativeTask(server, workerToken, task, tool, unavailable);
      return;
    }
    const runtimeUnavailable = preflightNativeRuntimeUnavailable(tool, diagnostics);
    if (runtimeUnavailable) {
      await failOrFallbackFromAppServerNativeTask(server, workerToken, task, tool, runtimeUnavailable);
      return;
    }

    const threadResult = await client.request<ThreadStartResult>("thread/start", {
      cwd: taskWorkspace.rootDir,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
      ephemeral,
      ...(model ? { model } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {}),
      ...(sandbox ? { sandbox } : {})
    });
    threadId = threadResult.thread?.id;
    if (!threadId) throw new Error("Codex app-server did not return a thread id.");

    if (tool === "browser") {
      const runtimeProbe = await inspectBrowserRuntimeViaAppServer(client, threadId, relevantSkills);
      if (runtimeProbe.line) {
        await log(server, workerToken, task.id, runtimeProbe.ready === false ? "warn" : "info", runtimeProbe.line);
      }
      diagnostics.browserUseRuntimeReady = runtimeProbe.ready;
      diagnostics.browserUseRuntimeDetail = runtimeProbe.detail;
      if (runtimeProbe.line) diagnostics.lines.push(runtimeProbe.line);
      if (runtimeProbe.ready === false && appServerBrowserRuntimeProbeRequired()) {
        await failOrFallbackFromAppServerNativeTask(server, workerToken, task, tool, [
          "Codex app-server exposed browser skills, but the Browser Use runtime did not expose a controllable backend from this worker process.",
          runtimeProbe.detail ? `Runtime probe: ${runtimeProbe.detail}` : "",
          "This usually means the raw app-server process can list skills, but it is not attached to Codex Desktop's in-app browser or Chrome native pipe."
        ].filter(Boolean).join("\n"));
        return;
      }
    }

    const prompt = codexAppServerNativePrompt(
      withTaskContext(task.prompt, server, task, attachedFiles, taskWorkspace),
      tool,
      relevantSkills,
      diagnostics
    );
    const turnResult = await client.request<TurnStartResult>("turn/start", {
      threadId,
      input: codexAppServerTurnInput(prompt, relevantSkills),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {})
    });
    activeTurnId = turnResult.turn?.id ?? activeTurnId;

    await Promise.race([
      turnDone,
      wait(timeoutMs).then(() => {
        throw new Error(`Codex app-server turn timed out after ${timeoutMs}ms.`);
      })
    ]);

    if (didCancel) {
      await canceled(server, workerToken, task.id, "Codex app-server task canceled and turn interrupt requested.");
      return;
    }
    if (!turnCompleted) {
      throw new Error("Codex app-server turn ended before a turn/completed notification was received.");
    }

    const output = agentText.trim() || `Codex app-server turn completed with status ${turnStatus || "completed"}.`;
    const nativeUnavailable = nativeToolUnavailableMessage(output, tool);
    if (nativeUnavailable) {
      await failOrFallbackFromAppServerNativeTask(server, workerToken, task, tool, nativeUnavailable);
      return;
    }
    if (turnError || /failed|error/i.test(turnStatus)) {
      await failOrFallbackFromAppServerNativeTask(server, workerToken, task, tool, turnError || `Codex app-server turn ended with status ${turnStatus}.`);
      return;
    }
    const artifacts = await collectTaskArtifacts(taskWorkspace.outputDir);
    await complete(server, workerToken, task.id, output, artifacts);
  } catch (error) {
    if (didCancel) {
      await canceled(server, workerToken, task.id, "Codex app-server task canceled.");
      return;
    }
    await fail(server, workerToken, task.id, error instanceof Error ? error.message : String(error));
  } finally {
    clearInterval(cancelTimer);
    releaseCodexAppServerClient(lease);
  }
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function codexAppServerArgs(input: { approvalPolicy?: string; sandbox?: string }) {
  const args = ["app-server"];
  const config: string[] = [];
  if (input.approvalPolicy) config.push(`approval_policy="${input.approvalPolicy}"`);
  if (input.sandbox) config.push(`sandbox_mode="${input.sandbox}"`);
  const memories = optionalEnv("CODEXBRO_APP_SERVER_MEMORIES");
  if (memories) config.push(`features.memories=${isTruthyEnv(memories) ? "true" : "false"}`);
  const extraConfig = optionalEnv("CODEXBRO_APP_SERVER_CONFIG");
  if (extraConfig) {
    config.push(...extraConfig.split(/[;\n]/).map((item) => item.trim()).filter(Boolean));
  }
  for (const item of config) {
    args.push("-c", item);
  }
  const disabledFeatures = optionalEnv("CODEXBRO_APP_SERVER_DISABLE_FEATURES");
  if (disabledFeatures) {
    for (const feature of disabledFeatures.split(",").map((item) => item.trim()).filter(Boolean)) {
      args.push("--disable", feature);
    }
  }
  const enabledFeatures = optionalEnv("CODEXBRO_APP_SERVER_ENABLE_FEATURES");
  if (enabledFeatures) {
    for (const feature of enabledFeatures.split(",").map((item) => item.trim()).filter(Boolean)) {
      args.push("--enable", feature);
    }
  }
  return args;
}

function isTruthyEnv(value: string) {
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function splitLogLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20);
}

function flattenCodexSkills(result: SkillsListResult) {
  return (result.data ?? []).flatMap((entry) => entry.skills ?? []);
}

function relevantNativeSkills(skills: ReturnType<typeof flattenCodexSkills>, tool: "browser" | "computer") {
  const terms = tool === "browser"
    ? ["browser:control-in-app-browser", "chrome:control-chrome", "vercel:agent-browser"]
    : ["cua-driver", "screenshot", "chrome:control-chrome"];
  return skills.filter((skill) => terms.some((term) => skill.name === term));
}

function preflightNativeSkillUnavailable(tool: "browser" | "computer", skills: ReturnType<typeof flattenCodexSkills>) {
  const relevant = relevantNativeSkills(skills, tool);
  if (tool === "browser" && !relevant.length) {
    return [
      "Codex app-server is reachable, but no native browser control skill was exposed.",
      "Expected one of: browser:control-in-app-browser, chrome:control-chrome, vercel:agent-browser."
    ].join("\n");
  }
  if (tool === "computer" && !relevant.length) {
    return [
      "Codex app-server is reachable, but no desktop/computer control skill was exposed.",
      "Expected one of: cua-driver, screenshot, chrome:control-chrome."
    ].join("\n");
  }
  return undefined;
}

function preflightNativeRuntimeUnavailable(tool: "browser" | "computer", diagnostics: NativeRuntimeDiagnostics) {
  if (tool === "computer" && diagnostics.cuaDriverReady === false && appServerCuaDriverRuntimeRequired()) {
    return [
      "Codex app-server exposed computer skills, but the CuaDriver runtime is not ready on this worker.",
      diagnostics.cuaDriverDetail ? `CuaDriver preflight: ${diagnostics.cuaDriverDetail}` : "",
      "This worker needs a working CuaDriver CLI with Accessibility and Screen Recording permissions for real macOS computer control."
    ].filter(Boolean).join("\n");
  }
  return undefined;
}

async function inspectNativeRuntimeDiagnostics(
  tool: "browser" | "computer",
  skills: ReturnType<typeof relevantNativeSkills>,
  cwd: string
): Promise<NativeRuntimeDiagnostics> {
  if (tool === "computer") {
    return inspectComputerRuntimeDiagnostics(skills, cwd);
  }

  const lines: string[] = [];
  if (skills.some((skill) => skill.name === "browser:control-in-app-browser")) {
    lines.push("In-app Browser skill is listed. In worker-launched app-server sessions, the iab runtime may still be unattached; Codex should fall back to Chrome if agent.browsers.list() is empty.");
  }

  const chromeSkill = skills.find((skill) => skill.name === "chrome:control-chrome" && skill.path);
  if (!chromeSkill?.path) {
    return { lines, chromeReady: false };
  }

  const chromeRoot = path.resolve(path.dirname(chromeSkill.path), "../..");
  const scripts = {
    running: path.join(chromeRoot, "scripts", "chrome-is-running.js"),
    installed: path.join(chromeRoot, "scripts", "check-extension-installed.js"),
    manifest: path.join(chromeRoot, "scripts", "check-native-host-manifest.js")
  };

  const [running, installed, manifest] = await Promise.all([
    runJsonCommand(process.execPath, [scripts.running, "--json"], cwd),
    runJsonCommand(process.execPath, [scripts.installed, "--json"], cwd),
    runJsonCommand(process.execPath, [scripts.manifest, "--json"], cwd)
  ]);
  const chromeRunning = Boolean(readBooleanProperty(running.json, "running"));
  const extensionInstalled = Boolean(readBooleanProperty(installed.json, "installed"));
  const extensionEnabled = Boolean(readBooleanProperty(installed.json, "enabled"));
  const nativeHostCorrect = Boolean(readBooleanProperty(manifest.json, "correct"));
  const chromeReady = chromeRunning && extensionInstalled && extensionEnabled && nativeHostCorrect;
  const extensionId = readStringProperty(installed.json, "extensionId");
  const profile = readStringProperty(installed.json, "selectedProfileDirectory");

  lines.push([
    "Chrome native runtime preflight:",
    `running=${chromeRunning}`,
    `extensionInstalled=${extensionInstalled}`,
    `extensionEnabled=${extensionEnabled}`,
    `nativeHostCorrect=${nativeHostCorrect}`,
    profile ? `profile=${profile}` : "",
    extensionId ? `extensionId=${extensionId}` : ""
  ].filter(Boolean).join(" "));

  for (const item of [
    ["chrome-is-running", running],
    ["check-extension-installed", installed],
    ["check-native-host-manifest", manifest]
  ] as const) {
    if (item[1].code !== 0) {
      lines.push(`${item[0]} exited with ${item[1].code}: ${(item[1].stderr || item[1].stdout).slice(0, 300)}`);
    }
  }

  return { lines, chromeReady };
}

async function inspectComputerRuntimeDiagnostics(
  skills: ReturnType<typeof relevantNativeSkills>,
  cwd: string
): Promise<NativeRuntimeDiagnostics> {
  const lines: string[] = [];
  if (skills.some((skill) => skill.name === "screenshot")) {
    lines.push("Screenshot skill is listed, but screenshot alone is observational and is not enough for desktop control.");
  }
  if (skills.some((skill) => skill.name === "chrome:control-chrome")) {
    lines.push("Chrome control skill is listed for computer tasks, but real macOS app control still requires CuaDriver or Codex Desktop Computer Use.");
  }
  if (!skills.some((skill) => skill.name === "cua-driver")) {
    return {
      lines,
      cuaDriverReady: false,
      cuaDriverDetail: "cua-driver skill not listed"
    };
  }

  const command = cuaDriverCommand();
  const detailParts: string[] = [`bin=${command}`];
  let version = "";
  let permissionsText = "";
  let statusText = "";
  let appCount: number | undefined;

  try {
    version = (await runQuiet(command, ["--version"], cwd)).trim();
    if (version) detailParts.push(`version=${version}`);
  } catch (error) {
    const detail = `version check failed: ${error instanceof Error ? error.message : String(error)}`;
    lines.push(`CuaDriver preflight: bin=${command} ready=false ${detail}`);
    return { lines, cuaDriverReady: false, cuaDriverDetail: detail };
  }

  try {
    permissionsText = await runQuiet(command, ["call", "check_permissions", JSON.stringify({ prompt: false })], cwd);
  } catch (error) {
    const detail = `permission check failed: ${error instanceof Error ? error.message : String(error)}`;
    lines.push(`CuaDriver preflight: ${detailParts.join(" ")} ready=false ${detail}`);
    return { lines, cuaDriverReady: false, cuaDriverDetail: detail };
  }

  const accessibilityGranted = /Accessibility:\s*granted/i.test(permissionsText);
  const screenRecordingGranted = /Screen Recording:\s*granted/i.test(permissionsText);
  detailParts.push(`accessibilityGranted=${accessibilityGranted}`, `screenRecordingGranted=${screenRecordingGranted}`);

  try {
    statusText = await runQuiet(command, ["status"], cwd);
    detailParts.push(`daemonRunning=${/daemon is running/i.test(statusText)}`);
  } catch {
    detailParts.push("daemonRunning=false");
  }

  const apps = await runJsonCommand(command, ["call", "list_apps", "{}"], cwd);
  if (apps.code === 0 && apps.json && typeof apps.json === "object" && Array.isArray((apps.json as { apps?: unknown }).apps)) {
    appCount = ((apps.json as { apps: unknown[] }).apps).length;
    detailParts.push(`appCount=${appCount}`);
  } else {
    detailParts.push(`listAppsOk=false`);
  }

  const ready = accessibilityGranted && screenRecordingGranted && appCount !== undefined;
  const detail = detailParts.join(" ");
  lines.push(`CuaDriver preflight: ready=${ready} ${detail}`);
  return {
    lines,
    cuaDriverReady: ready,
    cuaDriverDetail: detail
  };
}

async function inspectBrowserRuntimeViaAppServer(
  client: CodexAppServerClient,
  threadId: string,
  skills: ReturnType<typeof relevantNativeSkills>
): Promise<BrowserRuntimeProbeResult> {
  if (!appServerBrowserRuntimeProbeEnabled()) {
    return { line: "Codex app-server Browser Use runtime probe disabled by CODEXBRO_APP_SERVER_BROWSER_RUNTIME_PROBE=false." };
  }

  const chromeSkill = skills.find((skill) => skill.name === "chrome:control-chrome" && skill.path);
  const browserSkill = chromeSkill ?? skills.find((skill) => skill.name === "browser:control-in-app-browser" && skill.path);
  if (!browserSkill?.path) {
    return { ready: false, line: "Codex app-server Browser Use runtime probe skipped: no browser skill path was available.", detail: "missing-browser-skill-path" };
  }

  const pluginRoot = path.resolve(path.dirname(browserSkill.path), "../..");
  const browserClientPath = path.join(pluginRoot, "scripts", "browser-client.mjs");
  if (!await fileExists(browserClientPath)) {
    return {
      ready: false,
      line: `Codex app-server Browser Use runtime probe failed: missing ${browserClientPath}.`,
      detail: "missing-browser-client"
    };
  }

  const timeoutMs = Number(process.env.CODEXBRO_APP_SERVER_BROWSER_RUNTIME_PROBE_TIMEOUT_MS ?? 12000);
  const probeCode = browserRuntimeProbeCode(browserClientPath);
  try {
    const result = await client.request("mcpServer/tool/call", {
      threadId,
      server: "node_repl",
      tool: "js",
      arguments: {
        code: probeCode,
        timeout_ms: timeoutMs,
        title: "CodexBro browser runtime probe"
      },
      _meta: {
        "x-codex-turn-metadata": {
          session_id: threadId,
          thread_id: threadId,
          turn_id: `codexbro-runtime-probe-${Date.now()}`
        }
      }
    }, timeoutMs + 5000);

    const text = extractMcpText(result);
    const parsed = parseBrowserRuntimeProbeText(text);
    if (!parsed) {
      const detail = text.slice(0, 500) || "empty probe output";
      return {
        ready: false,
        line: `Codex app-server Browser Use runtime probe did not return structured output: ${detail}`,
        detail
      };
    }

    const discoveryFailures = browserRuntimeDiscoveryFailures(text);
    const backendCounts = typeof parsed.backendCounts === "object" && parsed.backendCounts
      ? Object.entries(parsed.backendCounts as Record<string, unknown>)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
      : "unknown";
    const requestMeta = parsed.requestMeta && typeof parsed.requestMeta === "object"
      ? parsed.requestMeta as Record<string, unknown>
      : undefined;
    const turnMetadata = requestMeta?.["x-codex-turn-metadata"];
    const turnMetadataObject = turnMetadata && typeof turnMetadata === "object"
      ? turnMetadata as Record<string, unknown>
      : undefined;
    const infos = Array.isArray(parsed.infos) ? parsed.infos : [];
    const detail = [
      `browserCount=${String(parsed.browserCount ?? 0)}`,
      `backendCounts=${backendCounts}`,
      `hasNativePipe=${String(parsed.hasNativePipe ?? false)}`,
      `extensionReachable=${String(parsed.extensionReachable ?? false)}`,
      `iabReachable=${String(parsed.iabReachable ?? false)}`,
      turnMetadataObject?.session_id ? `sessionId=${String(turnMetadataObject.session_id)}` : "",
      turnMetadataObject?.turn_id ? `turnId=${String(turnMetadataObject.turn_id)}` : "",
      infos.length ? `browsers=${summarizeBrowserProbeInfos(infos)}` : "",
      discoveryFailures.length ? `discoveryFailures=${discoveryFailures.join("; ").slice(0, 320)}` : "",
      parsed.extensionError ? `extensionError=${String(parsed.extensionError).slice(0, 180)}` : "",
      parsed.iabError ? `iabError=${String(parsed.iabError).slice(0, 180)}` : "",
      parsed.error ? `error=${String(parsed.error).slice(0, 180)}` : ""
    ].filter(Boolean).join(" ");
    const ready = Boolean(parsed.extensionReachable) || Number(parsed.browserCount ?? 0) > 0;
    return {
      ready,
      line: `Codex app-server Browser Use runtime probe: ${detail}`,
      detail
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ready: false,
      line: `Codex app-server Browser Use runtime probe failed: ${detail}`,
      detail
    };
  }
}

function browserRuntimeProbeCode(browserClientPath: string) {
  const browserClientUrl = pathToFileURL(browserClientPath).href;
  return `
await (async () => {
  const probe = {
    browserCount: 0,
    backendCounts: {},
    extensionReachable: false,
    iabReachable: false,
    hasNativePipe: Boolean(globalThis.nodeRepl?.nativePipe),
    hasCreateConnection: typeof globalThis.nodeRepl?.nativePipe?.createConnection === "function",
    requestMeta: globalThis.nodeRepl?.requestMeta ?? null,
    infos: []
  };
  try {
    const { setupBrowserRuntime } = await import(${JSON.stringify(browserClientUrl)});
    await setupBrowserRuntime({ globals: globalThis });
    const browsers = await agent.browsers.list();
    probe.browserCount = browsers.length;
    probe.backendCounts = browsers.reduce((counts, browser) => {
      const type = browser.type || "unknown";
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    probe.infos = browsers.map((browser) => ({
      name: browser.name,
      type: browser.type,
      metadata: browser.metadata ?? null
    }));
    try {
      await agent.browsers.get("extension");
      probe.extensionReachable = true;
    } catch (error) {
      probe.extensionError = error instanceof Error ? error.message : String(error);
    }
    try {
      await agent.browsers.get("iab");
      probe.iabReachable = true;
    } catch (error) {
      probe.iabError = error instanceof Error ? error.message : String(error);
    }
  } catch (error) {
    probe.error = error instanceof Error ? error.message : String(error);
  }
  console.log("CODEXBRO_BROWSER_RUNTIME_PROBE " + JSON.stringify(probe));
})();
`.trim();
}

function summarizeBrowserProbeInfos(infos: unknown[]) {
  return infos
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "unknown";
      const type = typeof record.type === "string" ? record.type : "unknown";
      const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : undefined;
      const session = metadata && typeof metadata.codexSessionId === "string" ? `:${metadata.codexSessionId}` : "";
      const profile = metadata && typeof metadata.profileName === "string" ? `:${metadata.profileName}` : "";
      return `${type}/${name}${session}${profile}`;
    })
    .filter(Boolean)
    .join(",");
}

function browserRuntimeDiscoveryFailures(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.includes("CODEXBRO_BROWSER_RUNTIME_PROBE "))
    .filter((line) => /IAB_DISCOVERY|pipe-connect|native pipe|Connection refused|Browser is not available/i.test(line))
    .map((line) => line.trim().replace(/\s+/g, " ").slice(0, 240))
    .slice(0, 4);
}

function parseBrowserRuntimeProbeText(text: string) {
  const marker = "CODEXBRO_BROWSER_RUNTIME_PROBE ";
  const line = text.split(/\r?\n/).find((item) => item.includes(marker));
  if (!line) return undefined;
  const jsonText = line.slice(line.indexOf(marker) + marker.length).trim();
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function extractMcpText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const content = (value as { content?: unknown }).content;
  if (Array.isArray(content)) {
    return content
      .map((item) => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "")
      .filter(Boolean)
      .join("\n");
  }
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function appServerBrowserRuntimeProbeEnabled() {
  return process.env.CODEXBRO_APP_SERVER_BROWSER_RUNTIME_PROBE !== "false";
}

function appServerBrowserRuntimeProbeRequired() {
  return process.env.CODEXBRO_APP_SERVER_REQUIRE_BROWSER_RUNTIME !== "false";
}

function appServerCuaDriverRuntimeRequired() {
  return process.env.CODEXBRO_APP_SERVER_REQUIRE_CUA_DRIVER !== "false";
}

async function logAppListBestEffort(
  client: CodexAppServerClient,
  server: string,
  workerToken: string,
  taskId: string
) {
  try {
    const result = await client.request<AppListResult>("app/list", {
      cursor: null,
      limit: 100,
      forceRefetch: true
    }, Number(process.env.CODEXBRO_APP_SERVER_APP_LIST_TIMEOUT_MS ?? 5000));
    const apps = result.data ?? [];
    if (!apps.length) return;
    const summary = apps
      .map((app) => `${app.name ?? app.id ?? "unknown"}${app.isEnabled === false ? " disabled" : ""}${app.isAccessible === false ? " inaccessible" : ""}`)
      .slice(0, 20)
      .join(", ");
    await log(server, workerToken, taskId, "info", `Codex app-server exposed apps: ${summary}.`);
  } catch (error) {
    await log(server, workerToken, taskId, "warn", `Codex app-server app/list probe skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function codexAppServerNativePrompt(
  prompt: string,
  tool: "browser" | "computer",
  skills: ReturnType<typeof relevantNativeSkills>,
  diagnostics: NativeRuntimeDiagnostics
) {
  const skillLines = skills.length
    ? [
      "Codex app-server preflight found these enabled local skills for this task:",
      ...skills.map((skill) => `- ${skill.name}${skill.path ? ` (${skill.path})` : ""}`),
      ""
    ]
    : [];

  if (tool === "browser") {
    const runtimeInstruction = diagnostics.browserUseRuntimeReady === true
      ? "Browser Use runtime probe passed in this app-server session, so use the discovered native browser backend directly."
      : diagnostics.browserUseRuntimeReady === false
        ? "Browser Use runtime probe did not expose a controllable backend in this app-server session. Do not claim browser actions succeeded unless a native browser call actually works."
        : diagnostics.chromeReady
          ? "Chrome runtime installation preflight passed, so prefer chrome:control-chrome for remote pages, existing login/session work, and any case where in-app browser reports no iab backend."
          : "Prefer browser:control-in-app-browser for local targets and chrome:control-chrome for existing Chrome login/session work when available.";
    return [
      "Execute this task through local Codex native browser tooling exposed in this app-server session.",
      runtimeInstruction,
      "In worker-launched app-server sessions, browser:control-in-app-browser may be listed while the iab runtime is unattached. If agent.browsers.list() is empty or agent.browsers.get(\"iab\") fails, immediately try chrome:control-chrome before declaring browser control unavailable.",
      "Do not replace native browser control with shell, curl, wget, node fetch, or a separate Playwright script unless Codex native browser tooling is unavailable.",
      "If both in-app Browser and Chrome native control are unavailable in this app-server turn, return a final answer starting with BROWSER_PLUGIN_UNAVAILABLE and explain why.",
      "Return a concise report with pages visited, actions taken, visible evidence, results, and blockers.",
      "",
      ...skillLines,
      ...diagnosticPromptLines(diagnostics),
      "User request:",
      prompt
    ].join("\n");
  }

  return [
    "Execute this task through local Codex native computer/desktop tooling exposed in this app-server session.",
    "Prefer Codex Computer Use or the cua-driver skill when a real macOS app, visible Chrome window, or desktop interaction is required.",
    "Do not replace native computer control with shell, curl, wget, node fetch, or a separate Playwright script unless native computer tooling is unavailable.",
    "Do not perform irreversible actions such as posting, deleting, buying, changing account settings, or sending messages unless the user explicitly requested that exact action.",
    "If native computer tooling is unavailable in this app-server turn, return a final answer starting with COMPUTER_USE_UNAVAILABLE and explain why.",
    "Return a concise report with visible evidence, actions taken, results, and blockers.",
    "",
    ...skillLines,
    ...diagnosticPromptLines(diagnostics),
    "User request:",
    prompt
  ].join("\n");
}

function codexAppServerTurnInput(prompt: string, skills: ReturnType<typeof relevantNativeSkills>): CodexUserInput[] {
  const selectedSkills = new Map<string, { name: string; path: string }>();
  for (const skill of skills) {
    if (!skill.path) continue;
    selectedSkills.set(skill.name, { name: skill.name, path: skill.path });
  }
  return [
    { type: "text", text: prompt, text_elements: [] },
    ...Array.from(selectedSkills.values()).map((skill): CodexUserInput => ({
      type: "skill",
      name: skill.name,
      path: skill.path
    }))
  ];
}

function diagnosticPromptLines(diagnostics: NativeRuntimeDiagnostics) {
  if (!diagnostics.lines.length) return [];
  return [
    "Local runtime diagnostics from the CodexBro worker:",
    ...diagnostics.lines.map((line) => `- ${line}`),
    ""
  ];
}

async function handleCodexAppServerRequest(
  server: string,
  workerToken: string,
  task: TaskRecord,
  cwd: string,
  message: Required<Pick<CodexAppServerMessage, "id" | "method">> & { params?: unknown }
) {
  if (message.method === "item/tool/requestUserInput") {
    await log(server, workerToken, task.id, "warn", `Codex app-server requested structured user input that CodexBro cannot answer yet: ${summarizeUnknown(message.params)}`);
    throw new Error("CodexBro worker cannot answer structured Codex user input requests yet.");
  }

  if (!isCodexApprovalRequest(message.method)) {
    await log(server, workerToken, task.id, "warn", `Unsupported Codex app-server request ${message.method}: ${summarizeUnknown(message.params)}`);
    throw new Error(`Unsupported Codex app-server request: ${message.method}`);
  }

  const command = extractRequestedCommand(message.params);
  const reason = [
    `Codex app-server requested approval for ${message.method}.`,
    command ? `Command/action: ${command}` : "",
    "Approve this task to continue the current local Codex turn, or cancel the task to reject it."
  ].filter(Boolean).join("\n");
  await api(server, `/api/worker/tasks/${task.id}/waiting-approval`, {
    method: "POST",
    workerToken,
    body: {
      reason,
      riskClass: "other",
      action: message.method,
      command,
      workingDirectory: cwd
    }
  });

  const approved = await waitForCodexBroApproval(server, workerToken, task.id);
  if (!approved) {
    throw new Error("Codex app-server request was canceled before approval.");
  }

  if (message.method === "item/permissions/requestApproval") {
    return {
      permissions: readObjectProperty(message.params, "permissions") ?? {},
      scope: "turn"
    };
  }

  return { decision: "accept" };
}

function isCodexApprovalRequest(method: string) {
  return method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval" ||
    method === "execCommandApproval" ||
    method === "applyPatchApproval";
}

async function waitForCodexBroApproval(server: string, workerToken: string, taskId: string) {
  const timeoutMs = Number(process.env.CODEXBRO_APP_SERVER_APPROVAL_TIMEOUT_MS ?? 900000);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const control = await getControl(server, workerToken, taskId);
    if (control.cancelRequested || control.status === "canceling" || control.status === "canceled") return false;
    if (control.status === "pending") return true;
    await wait(1500);
  }
  throw new Error(`Timed out waiting for CodexBro approval after ${timeoutMs}ms.`);
}

async function failOrFallbackFromAppServerNativeTask(
  server: string,
  workerToken: string,
  task: TaskRecord,
  tool: "browser" | "computer",
  reason: string
) {
  const fallback = appServerFallbackBackend();
  if (fallback === "desktop") {
    await log(server, workerToken, task.id, "warn", `Codex app-server native ${tool} backend unavailable; falling back to Codex Desktop bridge. ${reason}`);
    await runCodexDesktopTask(server, workerToken, task, tool);
    return;
  }
  if (fallback === "exec") {
    await log(server, workerToken, task.id, "warn", `Codex app-server native ${tool} backend unavailable; falling back to codex exec. ${reason}`);
    await runCodexExecTask(server, workerToken, task, codexNativeToolPrompt(task.prompt, tool), `Codex ${tool} exec fallback`, tool);
    return;
  }

  await fail(server, workerToken, task.id, [
    reason,
    "",
    "App-server fallback is disabled. Set CODEXBRO_APP_SERVER_FALLBACK=desktop to retry through the Codex Desktop bridge, or CODEXBRO_APP_SERVER_FALLBACK=exec to retry through codex exec."
  ].join("\n"));
}

function appServerFallbackBackend() {
  const configured = process.env.CODEXBRO_APP_SERVER_FALLBACK?.trim().toLowerCase();
  if (configured === "desktop" || configured === "exec") return configured;
  return undefined;
}

function summarizeCodexAppServerNotification(message: CodexAppServerMessage) {
  const method = message.method ?? "";
  if (method === "item/agentMessage/delta") return undefined;
  if (method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta") return undefined;
  if (method === "item/commandExecution/outputDelta") {
    const delta = readStringProperty(message.params, "delta");
    return delta ? `[codex command output] ${delta.trimEnd()}` : undefined;
  }
  if (method === "turn/started") {
    return `[codex] turn started ${readNestedString(message.params, ["turn", "id"]) ?? ""}`.trim();
  }
  if (method === "turn/completed") {
    const status = readNestedString(message.params, ["turn", "status"]) ?? "unknown";
    const error = readNestedString(message.params, ["turn", "error", "message"]);
    return `[codex] turn completed status=${status}${error ? ` error=${error}` : ""}`;
  }
  if (method === "item/started" || method === "item/completed") {
    const type = readNestedString(message.params, ["item", "type"]) ?? "item";
    const status = readNestedString(message.params, ["item", "status"]);
    const command = readNestedString(message.params, ["item", "command"]);
    return `[codex] ${method} type=${type}${status ? ` status=${status}` : ""}${command ? ` command=${command.split("\n")[0].slice(0, 120)}` : ""}`;
  }
  if (method === "error") {
    return `[codex] error ${readNestedString(message.params, ["error", "message"]) ?? summarizeUnknown(message.params)}`;
  }
  return method ? `[codex] ${method}` : undefined;
}

function extractRequestedCommand(value: unknown) {
  return readStringProperty(value, "command") ??
    readNestedString(value, ["item", "command"]) ??
    readNestedString(value, ["commandExecution", "command"]) ??
    readStringProperty(value, "summary") ??
    readStringProperty(value, "description");
}

function readNestedString(value: unknown, pathParts: string[]) {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function readStringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : undefined;
}

function readBooleanProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function readObjectProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return raw && typeof raw === "object" ? raw : undefined;
}

function summarizeUnknown(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
  }
}

async function runCodexDesktopTask(server: string, workerToken: string, task: TaskRecord, tool: "browser" | "computer") {
  if (process.platform !== "darwin") {
    await fail(server, workerToken, task.id, "Codex Desktop bridge is only available on macOS.");
    return;
  }

  const workingDirectory = resolveWorkingDirectory(task);
  if (!workingDirectory.allowed) {
    await fail(server, workerToken, task.id, workingDirectory.reason);
    return;
  }

  const attachedFiles = await getAttachedFiles(server, workerToken, task);
  const taskWorkspace = await prepareTaskWorkspace(server, workerToken, task, attachedFiles, workingDirectory.cwd);
  const marker = desktopTaskMarker(task);
  const doneMarker = `${marker}_DONE`;
  const resultDir = path.join(taskWorkspace.rootDir, "desktop-results");
  const resultFile = path.join(resultDir, `${task.id}.md`);
  const progressDir = path.join(taskWorkspace.rootDir, "desktop-progress");
  const progressFile = path.join(progressDir, `${task.id}.log`);
  await mkdir(resultDir, { recursive: true });
  await mkdir(progressDir, { recursive: true });
  await writeFile(progressFile, `${new Date().toISOString()} CodexBro 已提交任务到 Codex Desktop bridge。\n`);

  const desktopPrompt = desktopCodexPrompt({
    originalPrompt: task.prompt,
    mode: tool,
    marker,
    doneMarker,
    resultFile,
    progressFile,
    taskWorkspace
  });

  const bridge = await runCodexDesktopBridgeScript(server, workerToken, task, taskWorkspace.rootDir, desktopPrompt, marker, doneMarker, resultFile, progressFile);
  if (bridge.canceled) {
    await canceled(server, workerToken, task.id, "Codex Desktop bridge task canceled by user.");
    return;
  }
  if (!bridge.ok) {
    await failOrFallbackFromDesktopBridge(server, workerToken, task, tool, bridge.error);
    return;
  }

  const artifacts: TaskArtifact[] = await collectTaskArtifacts(taskWorkspace.outputDir);
  if (bridge.resultFileExists) {
    artifacts.push(await fileArtifactFromPath({
      id: `artifact_${task.id}_desktop_result`,
      name: path.basename(resultFile),
      filePath: resultFile
    }));
  }
  if (await fileExists(progressFile)) {
    artifacts.push(await fileArtifactFromPath({
      id: `artifact_${task.id}_desktop_progress`,
      name: path.basename(progressFile),
      filePath: progressFile
    }));
  }
  await complete(server, workerToken, task.id, bridge.result, artifacts);
}

async function runCodexDesktopBridgeScript(
  server: string,
  workerToken: string,
  task: TaskRecord,
  cwd: string,
  prompt: string,
  marker: string,
  doneMarker: string,
  resultFile: string,
  progressFile: string
) {
  const promptDir = path.join(cwd, ".codexbro", "desktop-prompts");
  await mkdir(promptDir, { recursive: true });
  const promptFile = path.join(promptDir, `${task.id}.txt`);
  await writeFile(promptFile, prompt);

  const script = await resolveCodexDesktopBridgeScript(cwd);
  const timeoutMs = process.env.CODEXBRO_DESKTOP_TIMEOUT_MS ?? "900000";
  const pollMs = process.env.CODEXBRO_DESKTOP_POLL_MS ?? "8000";
  const progressPollMs = Number(process.env.CODEXBRO_DESKTOP_PROGRESS_POLL_MS ?? 3000);
  await log(server, workerToken, task.id, "info", `Submitting task to Codex Desktop bridge script. Marker: ${marker}`);

  const result = await runProcess(server, workerToken, task.id, process.execPath, [
    script,
    "submit",
    "--cwd",
    cwd,
    "--prompt-file",
    promptFile,
    "--marker",
    marker,
    "--done-marker",
    doneMarker,
    "--result-file",
    resultFile,
    "--timeout-ms",
    timeoutMs,
    "--poll-ms",
    pollMs
  ], {
    shell: false,
    cwd,
    progressFile,
    progressPollMs,
    env: {
      CODEXBRO_CUA_DRIVER_BIN: process.env.CODEXBRO_CUA_DRIVER_BIN ?? defaultCuaDriverBin,
      ...(process.env.CODEXBRO_DESKTOP_ALLOW_FOREGROUND ? { CODEXBRO_DESKTOP_ALLOW_FOREGROUND: process.env.CODEXBRO_DESKTOP_ALLOW_FOREGROUND } : {}),
      ...(process.env.CODEXBRO_DESKTOP_FOREGROUND_PASTE ? { CODEXBRO_DESKTOP_FOREGROUND_PASTE: process.env.CODEXBRO_DESKTOP_FOREGROUND_PASTE } : {})
    }
  });

  if (result.canceled) return { ok: false as const, canceled: true as const };

  const resultFileExists = await fileExists(resultFile);
  const resultText = resultFileExists ? await readFile(resultFile, "utf8").catch(() => "") : "";
  if (result.code !== 0) {
    return {
      ok: false as const,
      canceled: false as const,
      resultFileExists,
      result: resultText.trim(),
      error: `Codex Desktop bridge script exited with code ${result.code}.\n${result.output}`
    };
  }

  return {
    ok: true as const,
    canceled: false as const,
    resultFileExists,
    result: resultText.trim() || result.output || `Codex Desktop bridge reported ${doneMarker}.`
  };
}

async function resolveCodexDesktopBridgeScript(cwd: string) {
  if (process.env.CODEXBRO_DESKTOP_BRIDGE_SCRIPT) {
    return path.resolve(process.env.CODEXBRO_DESKTOP_BRIDGE_SCRIPT);
  }

  const candidates = [
    ...ancestorDirectories(cwd).map((dir) => path.join(dir, "scripts", "codex-desktop-bridge.mjs")),
    path.resolve(process.cwd(), "scripts", "codex-desktop-bridge.mjs")
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return candidates[0];
}

function ancestorDirectories(start: string) {
  const directories: string[] = [];
  let current = path.resolve(start);
  for (;;) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

async function failOrFallbackFromDesktopBridge(
  server: string,
  workerToken: string,
  task: TaskRecord,
  tool: "browser" | "computer",
  reason: string
) {
  if (desktopFallbackEnabled()) {
    await log(server, workerToken, task.id, "warn", `Codex Desktop bridge failed; falling back to local Codex with CuaDriver instructions. ${reason}`);
    await runCodexExecTask(server, workerToken, task, codexCuaDriverFallbackPrompt(task.prompt, tool), "Codex CuaDriver desktop fallback");
    return;
  }

  await fail(server, workerToken, task.id, [
    "Codex Desktop bridge failed before the task could run through Codex Desktop Computer Use/Browser.",
    reason,
    "Fallback is disabled so this failure stays visible. Set CODEXBRO_DESKTOP_FALLBACK=exec_cuadriver only for explicit fallback testing."
  ].join("\n"));
}

function desktopFallbackEnabled() {
  return process.env.CODEXBRO_DESKTOP_FALLBACK === "exec_cuadriver";
}

async function prepareTaskWorkspace(
  server: string,
  workerToken: string,
  task: TaskRecord,
  files: WorkspaceFileRecord[],
  cwd: string
): Promise<TaskWorkspace> {
  const rootDir = path.join(cwd, ".codexbro", "task-workspaces", task.id, `attempt-${task.attempt}`);
  const inputDir = path.join(rootDir, "input");
  const outputDir = path.join(rootDir, "output");
  const scratchDir = path.join(rootDir, "scratch");
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(scratchDir, { recursive: true });

  const inputFiles: TaskWorkspace["inputFiles"] = [];

  for (const file of files) {
    const targetPath = await uniqueInputPath(inputDir, file.name, inputFiles.map((item) => item.path));
    await downloadWorkspaceFile(server, workerToken, task, file, targetPath);
    inputFiles.push({ id: file.id, name: file.name, path: targetPath, mimeType: file.mimeType, size: file.size });
  }

  return {
    rootDir,
    inputDir,
    outputDir,
    scratchDir,
    inputFiles
  };
}

async function downloadWorkspaceFile(
  server: string,
  workerToken: string,
  task: TaskRecord,
  file: WorkspaceFileRecord,
  targetPath: string
) {
  const response = await fetch(fileDownloadUrl(server, task.id, file.id), {
    headers: { Authorization: `Bearer ${workerToken}` }
  });
  if (!response.ok) {
    throw new Error(`Could not download attached file ${file.name}: ${response.status} ${await response.text()}`);
  }
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
}

async function uniqueInputPath(inputDir: string, name: string, usedPaths: string[]) {
  const safeName = safeFileName(name);
  const parsed = path.parse(safeName);
  let candidate = path.join(inputDir, safeName);
  let index = 2;
  while (usedPaths.includes(candidate) || await fileExists(candidate)) {
    candidate = path.join(inputDir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function desktopTaskMarker(task: TaskRecord) {
  return `CODEXBRO_${task.id.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
}

function desktopCodexPrompt(input: {
  originalPrompt: string;
  mode: "browser" | "computer";
  marker: string;
  doneMarker: string;
  resultFile: string;
  progressFile: string;
  taskWorkspace: TaskWorkspace;
}) {
  const modeInstruction = input.mode === "browser"
    ? "请优先使用 Codex Desktop 原生 Browser 插件或 in-app browser；如果任务需要真实登录态页面，可以使用 Computer Use 操作真实 Chrome。"
    : "请使用 Codex Desktop 原生 Computer Use 能力操作真实桌面/浏览器。";
  const fileLines = input.taskWorkspace.inputFiles.length
    ? [
      "",
      "服务器工作区附件已经由 CodexBro worker 拉取到本任务 input 目录，请按需读取这些本地文件：",
      ...input.taskWorkspace.inputFiles.map((file, index) => `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes): ${file.path}`)
    ]
    : [];

  return [
    `${input.marker} 这是 CodexBro 通过本地 Codex Desktop bridge 派发的任务。`,
    modeInstruction,
    "",
    "安全边界：",
    "1. 只执行用户明确要求的操作。",
    "2. 不要点赞、评论、关注、私信、发布、删除、购买、修改账号设置或执行其他不可逆动作，除非用户明确要求该具体动作。",
    "3. 如果遇到验证码、扫码登录、安全验证、权限不足或页面无法访问，请停止并如实说明。",
    "4. 请把结果写入下面的结果文件，文件必须包含任务标记、执行过程摘要、结果、限制或失败原因。",
    "5. 执行过程中请把阶段进度追加写入进度文件，每完成一个阶段追加一行，不要覆盖已有内容；每行尽量简短，便于 CodexBro Web 实时展示。",
    "6. 当前任务只能使用下面的干净任务空间；不要读取父目录或其他历史任务目录，除非用户明确要求。",
    "7. 如果用户要求截图、图片、导出的报告或其他文件，请把文件保存到任务 output 目录；CodexBro 会自动回传这些文件到 Web 端。",
    "",
    `任务空间：${input.taskWorkspace.rootDir}`,
    `输入目录：${input.taskWorkspace.inputDir}`,
    `临时目录：${input.taskWorkspace.scratchDir}`,
    `任务产物目录：${input.taskWorkspace.outputDir}`,
    `结果文件：${input.resultFile}`,
    `进度文件：${input.progressFile}`,
    "建议进度阶段：已收到任务 / 正在打开或检查目标 / 已完成关键操作 / 正在写结果 / 遇到阻塞。",
    `完成时最终回复必须包含：${input.doneMarker}`,
    ...fileLines,
    "",
    "用户任务：",
    input.originalPrompt
  ].join("\n");
}

function cuaDriverCommand() {
  return process.env.CODEXBRO_CUA_DRIVER_BIN ?? defaultCuaDriverBin;
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180) || "attachment";
}

async function fileExists(filePath: string) {
  return stat(filePath).then((item) => item.isFile()).catch(() => false);
}

async function getAttachedFiles(server: string, workerToken: string, task: TaskRecord) {
  if (!task.attachedFileIds.length) return [] as WorkspaceFileRecord[];
  const response = await api<{ files: WorkspaceFileRecord[] }>(server, `/api/worker/tasks/${task.id}/files`, {
    workerToken
  });
  return response.files;
}

function taskEnvironment(
  server: string,
  workerToken: string,
  task: TaskRecord,
  files: WorkspaceFileRecord[],
  taskWorkspace: TaskWorkspace
) {
  const fileManifest = files.map((file) => {
    const inputFile = taskWorkspace.inputFiles.find((item) => item.id === file.id);
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      downloadUrl: fileDownloadUrl(server, task.id, file.id),
      localPath: inputFile?.path ?? ""
    };
  });
  const env: Record<string, string> = {
    CODEXBRO_SERVER: server,
    CODEXBRO_WORKER_TOKEN: workerToken,
    CODEXBRO_TASK_ID: task.id,
    CODEXBRO_TASK_WORKSPACE_DIR: taskWorkspace.rootDir,
    CODEXBRO_TASK_INPUT_DIR: taskWorkspace.inputDir,
    CODEXBRO_TASK_OUTPUT_DIR: taskWorkspace.outputDir,
    CODEXBRO_TASK_SCRATCH_DIR: taskWorkspace.scratchDir,
    CODEXBRO_TASK_ARTIFACT_DIR: taskWorkspace.outputDir,
    CODEXBRO_TASK_ARTIFACTS_DIR: taskWorkspace.outputDir
  };
  if (files.length) {
    env.CODEXBRO_TASK_FILES_URL = `${server}/api/worker/tasks/${task.id}/files`;
    env.CODEXBRO_TASK_FILES_JSON = JSON.stringify(fileManifest);
    env.CODEXBRO_FIRST_FILE_URL = fileManifest[0]?.downloadUrl ?? "";
    env.CODEXBRO_FIRST_FILE_PATH = fileManifest[0]?.localPath ?? "";
  }
  return env;
}

function withTaskContext(prompt: string, server: string, task: TaskRecord, files: WorkspaceFileRecord[], taskWorkspace: TaskWorkspace) {
  const workspaceContext = [
    "CodexBro clean task workspace:",
    `- Task workspace: ${taskWorkspace.rootDir}`,
    `- Input directory copied from the server workspace: ${taskWorkspace.inputDir}`,
    `- Scratch directory for temporary work: ${taskWorkspace.scratchDir}`,
    `- Output/artifact directory: ${taskWorkspace.outputDir}`,
    "- Treat the server workspace files and this input directory as the task source of truth.",
    "- Work inside the task workspace. Do not read parent directories, older task folders, browser cache exports, or unrelated local files unless the user explicitly asks.",
    `- Save screenshots, generated images, exported reports, or any files the user should receive into: ${taskWorkspace.outputDir}`,
    "- Keep filenames readable, for example screenshot.png, result.jpg, report.pdf, or leads.csv.",
    "- CodexBro will automatically upload files from the output directory as downloadable task artifacts after the task completes.",
    "- Do not put secrets, browser cookies, access tokens, or unrelated local files in the output directory."
  ].join("\n");
  if (!files.length) return `${prompt}\n\n${workspaceContext}`;

  const manifest = files.map((file, index) => {
    const inputFile = taskWorkspace.inputFiles.find((item) => item.id === file.id);
    const downloadUrl = fileDownloadUrl(server, task.id, file.id);
    return `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes)\n   id: ${file.id}\n   local: ${inputFile?.path ?? ""}\n   download: curl -sS -H "Authorization: Bearer $CODEXBRO_WORKER_TOKEN" "${downloadUrl}" -o "${file.name}"`;
  }).join("\n");
  return `${prompt}\n\n${workspaceContext}\n\nThe user attached workspace files. They have already been copied from the server into the task input directory; use those local copies by default.\n${manifest}\n\nEnvironment available to commands:\n- CODEXBRO_WORKER_TOKEN: bearer token for task-scoped file downloads\n- CODEXBRO_TASK_FILES_JSON: JSON manifest with file ids, names, sizes, mime types, download URLs, and local paths\n- CODEXBRO_FIRST_FILE_PATH: local path for the first attached file\n- CODEXBRO_FIRST_FILE_URL: download URL for the first attached file, only when a fresh server pull is needed\n- CODEXBRO_TASK_WORKSPACE_DIR: clean local workspace for this task attempt\n- CODEXBRO_TASK_INPUT_DIR: local input files copied from the server\n- CODEXBRO_TASK_OUTPUT_DIR / CODEXBRO_TASK_ARTIFACT_DIR: local directory for files CodexBro should return to the user\n- CODEXBRO_TASK_SCRATCH_DIR: local temporary working directory\nDo not assume any other local files are relevant.`;
}

async function collectTaskArtifacts(artifactDir: string) {
  const maxFiles = positiveNumberEnv("CODEXBRO_TASK_ARTIFACT_MAX_FILES", defaultArtifactMaxFiles, 1);
  const maxBytes = positiveNumberEnv("CODEXBRO_TASK_ARTIFACT_MAX_BYTES", defaultArtifactMaxBytes, 1024);
  const paths = await listArtifactFiles(artifactDir);
  const artifacts: TaskArtifact[] = [];

  for (const filePath of paths.slice(0, maxFiles)) {
    const item = await stat(filePath).catch(() => undefined);
    if (!item?.isFile() || item.size > maxBytes) continue;
    const relativeName = path.relative(artifactDir, filePath).split(path.sep).join("-");
    artifacts.push(await fileArtifactFromPath({
      id: `artifact_${Date.now()}_${artifacts.length}`,
      name: safeFileName(relativeName || path.basename(filePath)),
      filePath
    }));
  }

  return artifacts;
}

async function listArtifactFiles(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listArtifactFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function fileArtifactFromPath(input: { id: string; name: string; filePath: string }): Promise<TaskArtifact> {
  const bytes = await readFile(input.filePath);
  const mimeType = mimeTypeForPath(input.filePath);
  return {
    id: input.id,
    name: input.name,
    type: "file",
    value: `data:${mimeType};base64,${bytes.toString("base64")}`,
    createdAt: new Date().toISOString()
  };
}

function mimeTypeForPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".apng": "image/apng",
    ".avif": "image/avif",
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".htm": "text/html",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp"
  };
  return types[ext] ?? "application/octet-stream";
}

function positiveNumberEnv(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, value);
}

function fileDownloadUrl(server: string, taskId: string, fileId: string) {
  return `${server}/api/worker/tasks/${taskId}/files/${fileId}/download`;
}

function codexNativeToolPrompt(prompt: string, tool: "browser" | "computer") {
  if (tool === "browser") {
    return [
      "Execute this request through Codex's native Browser plugin or in-app browser tooling when available.",
      "Do not use shell, curl, wget, node fetch, or a separate Playwright/browser script for browser operations.",
      "If the native Browser plugin is unavailable in this Codex process, return a final answer starting with BROWSER_PLUGIN_UNAVAILABLE followed by a concise reason.",
      "Return a concise task report with the pages visited, actions taken, results, and any blocker.",
      "",
      "User request:",
      prompt
    ].join("\n");
  }

  return [
    "Execute this request through Codex's native Computer Use capability or Codex browser/desktop tooling when available.",
    "The web app is only dispatching the task; Codex should decide the actual computer/browser operations.",
    "Do not use shell, curl, wget, node fetch, or a separate Playwright/browser script to simulate desktop/browser operations.",
    "If native Computer Use is unavailable in this Codex process, return a final answer starting with COMPUTER_USE_UNAVAILABLE followed by a concise reason.",
    "Do not perform irreversible actions such as posting, deleting, buying, changing account settings, or sending messages unless the user explicitly requested that exact action.",
    "Return a concise task report with visible evidence, actions taken, results, and any blocker.",
    "",
    "User request:",
    prompt
  ].join("\n");
}

function codexCuaDriverFallbackPrompt(prompt: string, tool: "browser" | "computer") {
  const surface = tool === "browser"
    ? "browser task. Prefer Codex Browser plugin if it is available; otherwise use CuaDriver to operate the real macOS browser in the background."
    : "computer task. Prefer Codex Computer Use if it is available; otherwise use CuaDriver to operate real macOS apps in the background.";
  return [
    `Execute this ${surface}`,
    "CodexBro attempted the Codex Desktop UI bridge first, but that UI submission path was unavailable in this local state.",
    "You may use the CuaDriver CLI at /Applications/CuaDriver.app/Contents/MacOS/cua-driver for desktop/browser automation.",
    "Follow CuaDriver's snapshot-before-action pattern: list apps/windows, call get_window_state for the target window, then click/type/scroll by element_index or window-local coordinates.",
    "Do not use destructive actions. Do not post, like, comment, follow, message, buy, delete, or change account settings unless the user explicitly requested that exact action.",
    "If a site asks for CAPTCHA, scan-login, security verification, or additional credentials, stop and report it.",
    "Return a concise Chinese report with actions taken, evidence observed, results, and blockers.",
    "",
    "User request:",
    prompt
  ].join("\n");
}

function nativeToolUnavailableMessage(output: string, tool: "browser" | "computer") {
  const marker = tool === "browser" ? "BROWSER_PLUGIN_UNAVAILABLE" : "COMPUTER_USE_UNAVAILABLE";
  const pattern = new RegExp(`(^|\\n)${marker}\\b(?::|，|,)?\\s*([^\\n]*)`, "i");
  const match = output.match(pattern);
  if (!match) return undefined;

  const label = tool === "browser" ? "Codex Browser plugin" : "Codex Computer Use";
  const detail = match[2]?.trim();
  return [
    `${label} is not available to this worker process.`,
    detail ? `Codex reported: ${detail}` : "",
    "Current result: the task was dispatched to local Codex, but the native desktop/browser tool channel is not exposed from this process."
  ].filter(Boolean).join("\n");
}


function classifyApprovalRisk(command: string) {
  if (/\brm\s+-rf\b/.test(command)) return "destructive";
  if (/\bsudo\b/.test(command)) return "privileged";
  if (/curl\b.+\|\s*(sh|bash)/.test(command) || /wget\b.+\|\s*(sh|bash)/.test(command)) return "network_pipe";
  if (/\bchmod\s+-R\b/.test(command) || /\bchown\s+-R\b/.test(command)) return "filesystem";
  if (dangerousPatterns.some((pattern) => pattern.test(command))) return "other";
  return undefined;
}

function resolveWorkingDirectory(task: TaskRecord) {
  const cwd = path.resolve(task.workingDirectory || process.cwd());
  const allowed = currentAllowedDirectories.some((dir) => cwd === dir || cwd.startsWith(`${dir}${path.sep}`));
  if (!allowed) {
    return {
      allowed: false as const,
      cwd,
      reason: `Working directory is outside this worker's allowlist: ${cwd}`
    };
  }
  return { allowed: true as const, cwd, reason: "" };
}

function runProcess(
  server: string,
  workerToken: string,
  taskId: string,
  command: string,
  args: string[],
  options: { shell: boolean; cwd: string; env?: Record<string, string>; progressFile?: string; progressPollMs?: number }
) {
  return new Promise<{ code: number | null; output: string; canceled: boolean }>((resolve) => {
    const child = spawn(command, args, {
      shell: options.shell,
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let didCancel = false;
    let settled = false;
    let progressOffset = 0;
    let progressRemainder = "";
    let progressFlush = Promise.resolve();

    const flushProgress = async (final = false) => {
      if (!options.progressFile) return;
      const content = await readFile(options.progressFile, "utf8").catch(() => undefined);
      if (content === undefined) return;
      if (content.length < progressOffset) {
        progressOffset = 0;
        progressRemainder = "";
      }
      const next = content.slice(progressOffset);
      progressOffset = content.length;
      const combined = progressRemainder + next;
      const lines = combined.split(/\r?\n/);
      progressRemainder = final ? "" : lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          await log(server, workerToken, taskId, "info", `[desktop progress] ${trimmed}`);
        }
      }
    };
    const queueProgressFlush = (final = false) => {
      progressFlush = progressFlush.then(() => flushProgress(final)).catch(() => undefined);
      return progressFlush;
    };

    const cancelTimer = setInterval(() => {
      void getControl(server, workerToken, taskId).then((control) => {
        if (!control.cancelRequested || didCancel) return;
        didCancel = true;
        void log(server, workerToken, taskId, "warn", "Cancellation received. Interrupting process.");
        terminateChild(child);
      }).catch(() => undefined);
    }, 1000);
    const progressTimer = options.progressFile
      ? setInterval(() => {
        void queueProgressFlush(false);
      }, Math.max(500, options.progressPollMs ?? 3000))
      : undefined;
    void queueProgressFlush(false);

    const finish = (result: { code: number | null; output: string; canceled: boolean }) => {
      if (settled) return;
      settled = true;
      clearInterval(cancelTimer);
      if (progressTimer) clearInterval(progressTimer);
      void queueProgressFlush(true).finally(() => resolve(result));
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const message = chunk.toString();
      output += message;
      void log(server, workerToken, taskId, "stdout", message.trimEnd());
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString();
      output += message;
      void log(server, workerToken, taskId, "stderr", message.trimEnd());
    });

    child.on("error", (error) => {
      void log(server, workerToken, taskId, "error", error.message);
      finish({ code: 1, output: error.message, canceled: didCancel });
    });

    child.on("close", (code) => {
      finish({ code, output: output.trim(), canceled: didCancel });
    });
  });
}

function runQuiet(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`${command} ${args[0] ?? ""} exited with code ${code}: ${stderr || stdout}`.trim()));
    });
  });
}

function runJsonCommand(command: string, args: string[], cwd: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; json?: unknown }>((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), json });
    });
  });
}

function runJsonCommandWithTimeout(command: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; json?: unknown }>((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (code: number | null, extraStderr = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      resolve({ code, stdout: stdout.trim(), stderr: (stderr + extraStderr).trim(), json });
    };
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(1, `\nTimed out after ${timeoutMs}ms.`);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish(1, error.message);
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}

async function commandSucceeds(command: string, args: string[], cwd: string) {
  return runQuiet(command, args, cwd).then(() => true).catch(() => false);
}

function terminateChild(child: ChildProcess) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    if (child.killed || !child.pid) return;
    try {
      if (process.platform === "win32") {
        child.kill("SIGKILL");
      } else {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
  }, 3000);
}

async function log(server: string, workerToken: string, taskId: string, level: LogLevel, message: string) {
  if (!message) return;
  await api(server, `/api/worker/tasks/${taskId}/logs`, {
    method: "POST",
    workerToken,
    body: { level, message }
  });
}

async function complete(
  server: string,
  workerToken: string,
  taskId: string,
  result: string,
  artifacts: TaskArtifact[] = []
) {
  await api(server, `/api/worker/tasks/${taskId}/complete`, {
    method: "POST",
    workerToken,
    body: { result, artifacts }
  });
}

async function fail(server: string, workerToken: string, taskId: string, error: string) {
  await api(server, `/api/worker/tasks/${taskId}/fail`, {
    method: "POST",
    workerToken,
    body: { error }
  });
}

async function canceled(server: string, workerToken: string, taskId: string, result: string) {
  await api(server, `/api/worker/tasks/${taskId}/canceled`, {
    method: "POST",
    workerToken,
    body: { result }
  });
}

async function getControl(server: string, workerToken: string, taskId: string) {
  return api<WorkerTaskControlResponse>(server, `/api/worker/tasks/${taskId}/control`, {
    workerToken
  });
}

async function isCancellationRequested(server: string, workerToken: string, taskId: string) {
  const control = await getControl(server, workerToken, taskId);
  return control.cancelRequested;
}

async function api<T>(
  server: string,
  path: string,
  options: { method?: string; workerToken?: string; body?: unknown } = {}
) {
  const response = await fetch(`${server}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.workerToken ? { Authorization: `Bearer ${options.workerToken}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    throw new ApiError(options.method ?? "GET", path, response.status, await response.text());
  }

  return (await response.json()) as T;
}

class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly responseText: string
  ) {
    super(`${method} ${path} failed: ${status} ${responseText}`);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let currentAllowedDirectories: string[] = [process.cwd()];

process.once("SIGINT", () => {
  destroyCodexAppServerPool();
  process.exit(130);
});

process.once("SIGTERM", () => {
  destroyCodexAppServerPool();
  process.exit(143);
});

main().catch((error) => {
  destroyCodexAppServerPool();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

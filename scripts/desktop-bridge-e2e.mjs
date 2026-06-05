import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const dataDir = mkdtempSync(path.join(os.tmpdir(), "codexbro-desktop-e2e-"));
const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const processes = [];

function log(message) {
  console.log(`[desktop-e2e] ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("Could not allocate a free port"));
      });
    });
  });
}

function spawnProcess(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });
  processes.push({ name, child });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
}

async function waitFor(predicate, message, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(message);
}

async function json(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function userHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function login() {
  const response = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "desktop-e2e@codexbro.local", password: "codexbro-desktop-e2e" })
  });
  assert(response.status === 200, `login failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function getTask(token, taskId) {
  const response = await json(`/api/tasks/${taskId}`, { headers: userHeaders(token) });
  assert(response.status === 200, `task get failed: ${JSON.stringify(response.body)}`);
  return response.body.task;
}

async function getTaskLogs(token, taskId) {
  const response = await json(`/api/tasks/${taskId}/logs`, { headers: userHeaders(token) });
  assert(response.status === 200, `task logs failed: ${JSON.stringify(response.body)}`);
  return response.body.logs ?? [];
}

async function pollTerminalTask(token, taskId, timeoutMs = 360000) {
  return waitFor(async () => {
    const task = await getTask(token, taskId);
    return ["completed", "failed", "canceled"].includes(task.status) ? task : null;
  }, `task ${taskId} did not finish`, timeoutMs);
}

async function createTask(token, input) {
  const response = await json("/api/tasks", {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify(input)
  });
  assert([200, 201].includes(response.status), `task create failed: ${JSON.stringify(response.body)}`);
  return response.body.task;
}

async function main() {
  assert(process.platform === "darwin", "Desktop bridge E2E requires macOS and Codex Desktop.");
  log(`using temporary data dir ${dataDir}`);

  spawnProcess("server", "npm", ["--silent", "--workspace", "@codexbro/server", "run", "dev"], {
    PORT: String(port),
    HOST: "127.0.0.1",
    CODEXBRO_DATA_DIR: dataDir
  });

  await waitFor(async () => {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, "server did not become healthy");
  log("server is healthy");

  const session = await login();
  const token = session.token;
  const workspaces = await json("/api/workspaces", { headers: userHeaders(token) });
  const workspaceId = workspaces.body.workspaces?.[0]?.id;
  assert(workspaceId, "default workspace was not created");

  const pairing = await json("/api/workers/pairing-token", {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({ workspaceId })
  });
  assert(pairing.status === 200, `pairing token failed: ${JSON.stringify(pairing.body)}`);

  spawnProcess("worker", "npm", [
    "--silent",
    "--workspace",
    "@codexbro/worker",
    "run",
    "dev",
    "--",
    "--server",
    baseUrl,
    "--pairing-token",
    pairing.body.pairingToken,
    "--name",
    "CodexBro Desktop E2E Worker",
    "--allowed-dir",
    rootDir,
    "--allowed-mode",
    "shell",
    "--allowed-mode",
    "codex",
    "--allowed-mode",
    "browser",
    "--allowed-mode",
    "computer"
  ], {
    CODEXBRO_NATIVE_TASK_BACKEND: "desktop",
    CODEXBRO_DESKTOP_ALLOW_FOREGROUND: "true",
    CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS: "true",
    CODEXBRO_DESKTOP_BRIDGE_SMOKE_TIMEOUT_MS: "180000",
    CODEXBRO_DESKTOP_TIMEOUT_MS: "360000",
    CODEXBRO_DESKTOP_POLL_MS: "5000",
    CODEXBRO_DESKTOP_PROGRESS_POLL_MS: "1000",
    CODEXBRO_NATIVE_READINESS_REFRESH_MS: "3600000"
  });

  const worker = await waitFor(async () => {
    const response = await json("/api/workers", { headers: userHeaders(token) });
    return response.body.workers?.find((item) => item.name === "CodexBro Desktop E2E Worker" && item.status === "online");
  }, "desktop worker did not register after Desktop Smoke", 240000);
  assert(worker.nativeReadiness?.backend === "desktop", "desktop worker did not select desktop backend");
  assert(worker.nativeReadiness?.codexDesktopSmoke?.ok === true, `Desktop Smoke was not ready: ${JSON.stringify(worker.nativeReadiness?.codexDesktopSmoke)}`);
  log("desktop worker registered with Desktop Smoke ready");

  const browserTask = await createTask(token, {
    workerId: worker.id,
    mode: "browser",
    workingDirectory: rootDir,
    prompt: [
      "Use Codex native browser control to open https://example.com/.",
      "Read the page title or main heading.",
      "Your result should include the exact text Example Domain."
    ].join(" "),
    idempotencyKey: "desktop-e2e-browser"
  });
  const browserResult = await pollTerminalTask(token, browserTask.id);
  assert(browserResult.status === "completed", `browser task failed: ${browserResult.error ?? browserResult.result}`);
  assert(browserResult.result?.includes("Example Domain"), `browser result did not include Example Domain: ${browserResult.result}`);
  const browserLogs = await getTaskLogs(token, browserTask.id);
  assert(browserLogs.some((item) => item.message?.includes("[desktop progress]")), "browser task did not stream desktop progress logs");
  log("browser task completed through Codex Desktop bridge");

  const computerTask = await createTask(token, {
    workerId: worker.id,
    mode: "computer",
    workingDirectory: rootDir,
    prompt: [
      "Use Codex native computer/desktop control to inspect the local Codex Desktop app/window state.",
      "Report the observed app or window name.",
      "Your result should include Codex."
    ].join(" "),
    idempotencyKey: "desktop-e2e-computer"
  });
  const computerResult = await pollTerminalTask(token, computerTask.id);
  assert(computerResult.status === "completed", `computer task failed: ${computerResult.error ?? computerResult.result}`);
  assert(computerResult.result?.includes("Codex"), `computer result did not include Codex: ${computerResult.result}`);
  const computerLogs = await getTaskLogs(token, computerTask.id);
  assert(computerLogs.some((item) => item.message?.includes("[desktop progress]")), "computer task did not stream desktop progress logs");
  log("computer task completed through Codex Desktop bridge");

  log("all desktop bridge checks passed");
}

async function cleanup() {
  for (const { child } of processes.toReversed()) {
    if (!child.killed) child.kill("SIGINT");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(dataDir, { recursive: true, force: true });
}

main()
  .catch((error) => {
    console.error(`[desktop-e2e] ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  })
  .finally(cleanup);

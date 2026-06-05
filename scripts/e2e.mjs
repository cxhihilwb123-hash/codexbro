import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const rootDir = process.cwd();
const dataDir = mkdtempSync(path.join(os.tmpdir(), "codexbro-e2e-"));
const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const processes = [];

const fakeCodexBin = path.join(dataDir, process.platform === "win32" ? "fake-codex.cmd" : "fake-codex");
writeFileSync(fakeCodexBin, process.platform === "win32"
  ? "@echo off\r\necho fake codex exec ok\r\necho %*\r\n"
  : [
    "#!/usr/bin/env node",
    "const args = process.argv.slice(2);",
    "console.log('fake codex exec ok');",
    "console.log(args.join(' '));"
  ].join("\n"));
if (process.platform !== "win32") chmodSync(fakeCodexBin, 0o755);

const fakeUnavailableCodexBin = path.join(dataDir, process.platform === "win32" ? "fake-codex-unavailable.cmd" : "fake-codex-unavailable");
writeFileSync(fakeUnavailableCodexBin, process.platform === "win32"
  ? "@echo off\r\necho BROWSER_PLUGIN_UNAVAILABLE no browser bridge in this process\r\n"
  : [
    "#!/usr/bin/env node",
    "console.log('BROWSER_PLUGIN_UNAVAILABLE no browser bridge in this process');"
  ].join("\n"));
if (process.platform !== "win32") chmodSync(fakeUnavailableCodexBin, 0o755);

function log(message) {
  console.log(`[e2e] ${message}`);
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

async function waitFor(predicate, message, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
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

function workerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email = "founder@codexbro.local", password = "codexbro-demo") {
  const response = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  assert(response.status === 200, `login failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function createCustomer(adminToken, input) {
  const response = await json("/api/admin/users", {
    method: "POST",
    headers: userHeaders(adminToken),
    body: JSON.stringify(input)
  });
  assert(response.status === 201, `customer create failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function pairWorker(token, workspaceId) {
  const response = await json("/api/workers/pairing-token", {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({ workspaceId })
  });
  assert(response.status === 200, `pairing token failed: ${JSON.stringify(response.body)}`);
  assert(response.body.recommendedCommand?.includes("CODEXBRO_NATIVE_TASK_BACKEND=desktop"), "pairing command is missing desktop backend env");
  assert(response.body.recommendedCommand?.includes("CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true"), "pairing command is missing foreground env");
  assert(response.body.recommendedCommand?.includes("CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true"), "pairing command is missing desktop smoke env");
  assert(response.body.recommendedCommand?.includes("--token-file .codexbro/worker-token.json"), "pairing command is missing worker token file");
  return response.body;
}

async function registerWorker(pairingToken, name) {
  const response = await json("/api/worker/register", {
    method: "POST",
    body: JSON.stringify({
      pairingToken,
      name,
      capabilities: ["shell"],
      allowedModes: ["shell"],
      allowedDirectories: [rootDir],
      browserProfileDir: path.join(dataDir, "browser-profile")
    })
  });
  assert(response.status === 201, `worker register failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function createTask(token, input) {
  const response = await json("/api/tasks", {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify(input)
  });
  assert([200, 201].includes(response.status), `task create failed: ${JSON.stringify(response.body)}`);
  return response;
}

async function uploadWorkspaceFile(token, workspaceId, name, content, mimeType = "text/plain") {
  const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
      "x-file-name": encodeURIComponent(name)
    },
    body: Buffer.from(content)
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 201, `file upload failed: ${JSON.stringify(body)}`);
  return body.file;
}

async function getTask(token, taskId) {
  const response = await json(`/api/tasks/${taskId}`, { headers: userHeaders(token) });
  assert(response.status === 200, `task get failed: ${JSON.stringify(response.body)}`);
  return response.body.task;
}

async function pollTask(token, taskId, terminal = true, timeoutMs = 20000) {
  return waitFor(async () => {
    const task = await getTask(token, taskId);
    if (terminal) {
      return ["completed", "failed", "canceled"].includes(task.status) ? task : null;
    }
    return task;
  }, `task ${taskId} did not reach expected state`, timeoutMs);
}

async function main() {
  log(`using temporary data dir ${dataDir}`);
  spawnProcess("server", "npm", ["--silent", "--workspace", "@codexbro/server", "run", "dev"], {
    PORT: String(port),
    HOST: "127.0.0.1",
    CODEXBRO_DATA_DIR: dataDir,
    CODEXBRO_STALE_WORKER_MS: "500",
    CODEXBRO_STALE_MAX_ATTEMPTS: "2",
    CODEXBRO_STALE_RETRY_BACKOFF_MS: "300"
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

  const unknownLogin = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "unknown-customer@codexbro.local", password: "nope" })
  });
  assert(unknownLogin.status === 401, "unknown customer was allowed to self-register");
  const adminSession = await login();
  assert(adminSession.user.platformRole === "admin", "bootstrap account is not a platform admin");
  const adminUsersBefore = await json("/api/admin/users", { headers: userHeaders(adminSession.token) });
  assert(adminUsersBefore.status === 200 && adminUsersBefore.body.users.some((user) => user.email === "founder@codexbro.local"), "admin users endpoint did not list bootstrap admin");
  await createCustomer(adminSession.token, {
    email: "e2e@codexbro.local",
    password: "codexbro-e2e",
    workspaceName: "E2E Customer Workspace",
    platformRole: "user",
    workspaceRole: "owner"
  });
  const disabledCustomer = await createCustomer(adminSession.token, {
    email: "disabled@codexbro.local",
    password: "codexbro-disabled",
    workspaceName: "Disabled Customer Workspace",
    platformRole: "user",
    workspaceRole: "owner"
  });
  const disabled = await json(`/api/admin/users/${disabledCustomer.user.id}`, {
    method: "PATCH",
    headers: userHeaders(adminSession.token),
    body: JSON.stringify({ disabled: true })
  });
  assert(disabled.status === 200 && disabled.body.user.disabledAt, "admin could not disable a customer");
  const disabledLogin = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "disabled@codexbro.local", password: "codexbro-disabled" })
  });
  assert(disabledLogin.status === 403, "disabled customer was allowed to login");
  log("admin customer provisioning completed");

  const session = await login("e2e@codexbro.local", "codexbro-e2e");
  assert(session.user.platformRole === "user", "customer login did not return a user platform role");
  const forbiddenAdmin = await json("/api/admin/users", { headers: userHeaders(session.token) });
  assert(forbiddenAdmin.status === 403, "customer can access platform admin endpoint");
  const token = session.token;
  const workspaces = await json("/api/workspaces", { headers: userHeaders(token) });
  assert(workspaces.body.workspaces?.[0]?.role === "owner", "default owner workspace was not created");
  const workspaceId = workspaces.body.workspaces[0].id;

  const uploadedFile = await uploadWorkspaceFile(token, workspaceId, "brief.txt", "codexbro uploaded file ok");
  const fileList = await json(`/api/workspace-files?workspaceId=${workspaceId}`, { headers: userHeaders(token) });
  assert(fileList.body.files.some((file) => file.id === uploadedFile.id), "uploaded workspace file did not appear in list");
  const downloaded = await fetch(`${baseUrl}/api/workspace-files/${uploadedFile.id}/download`, {
    headers: userHeaders(token)
  });
  assert(downloaded.status === 200 && await downloaded.text() === "codexbro uploaded file ok", "workspace file download did not match upload");
  log("workspace file upload/list/download completed");

  const createdTemplate = await json(`/api/workspaces/${workspaceId}/prompt-templates`, {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({
      title: "E2E Lead Template",
      description: "Collect public leads",
      prompt: "Collect public customer information and stop before outbound actions.",
      mode: "browser"
    })
  });
  assert(createdTemplate.status === 201 && createdTemplate.body.template.mode === "browser", `prompt template create failed: ${JSON.stringify(createdTemplate.body)}`);
  const listedTemplates = await json(`/api/prompt-templates?workspaceId=${workspaceId}`, { headers: userHeaders(token) });
  assert(listedTemplates.body.templates.some((template) => template.id === createdTemplate.body.template.id), "created prompt template did not appear in list");
  const updatedTemplate = await json(`/api/prompt-templates/${createdTemplate.body.template.id}`, {
    method: "PATCH",
    headers: userHeaders(token),
    body: JSON.stringify({
      title: "E2E Lead Template Updated",
      description: "Prepare draft only",
      prompt: "Prepare a low-risk outreach draft and wait for human approval.",
      mode: "computer"
    })
  });
  assert(updatedTemplate.status === 200 && updatedTemplate.body.template.mode === "computer", `prompt template update failed: ${JSON.stringify(updatedTemplate.body)}`);
  const deletedTemplate = await json(`/api/prompt-templates/${createdTemplate.body.template.id}`, {
    method: "DELETE",
    headers: userHeaders(token)
  });
  assert(deletedTemplate.status === 200, `prompt template delete failed: ${JSON.stringify(deletedTemplate.body)}`);
  const persistedTemplate = await json(`/api/workspaces/${workspaceId}/prompt-templates`, {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({
      title: "E2E Persisted Template",
      description: "Keep one template for SQLite persistence",
      prompt: "Persist this reusable prompt template.",
      mode: "codex"
    })
  });
  assert(persistedTemplate.status === 201 && persistedTemplate.body.template.mode === "codex", "persisted prompt template was not created");
  log("workspace prompt template CRUD completed");

  const pairing = await pairWorker(token, workspaceId);
  const realWorkerTokenFile = path.join(dataDir, "real-worker-token.json");
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
    pairing.pairingToken,
    "--token-file",
    realWorkerTokenFile,
    "--name",
    "CodexBro E2E Worker",
    "--allowed-dir",
    rootDir,
    "--allowed-mode",
    "shell",
    "--browser-profile-dir",
    path.join(dataDir, "real-browser-profile")
  ]);

  const worker = await waitFor(async () => {
    const response = await json("/api/workers", { headers: userHeaders(token) });
    return response.body.workers?.find((item) => item.name === "CodexBro E2E Worker" && item.status === "online");
  }, "real worker did not register");
  assert(JSON.stringify(worker.allowedModes) === JSON.stringify(["shell"]), "real worker is not shell-only");
  assert(worker.nativeReadiness?.backend, "worker did not report native readiness");
  assert(typeof worker.nativeReadiness.codexCli?.ok === "boolean", "native readiness is missing Codex CLI status");
  const persistedToken = JSON.parse(readFileSync(realWorkerTokenFile, "utf8"));
  assert(persistedToken.workerId === worker.id && typeof persistedToken.workerToken === "string", "worker token file did not persist the registered worker");
  if (process.platform !== "win32") {
    assert((statSync(realWorkerTokenFile).mode & 0o777) === 0o600, "worker token file permissions are not owner-only");
  }
  log("real worker registered");

  const reusedPairing = await json("/api/worker/register", {
    method: "POST",
    body: JSON.stringify({
      pairingToken: pairing.pairingToken,
      name: "CodexBro Reused Pairing Worker",
      capabilities: ["shell"],
      allowedModes: ["shell"],
      allowedDirectories: [rootDir]
    })
  });
  assert(reusedPairing.status === 401, "pairing token was reusable after worker registration");
  log("pairing token reuse was rejected");

  const shell = await createTask(token, {
    workerId: worker.id,
    mode: "shell",
    prompt: "pwd && printf '\\n' && cat \"$CODEXBRO_FIRST_FILE_PATH\"",
    workingDirectory: rootDir,
    attachedFileIds: [uploadedFile.id],
    idempotencyKey: "script-shell"
  });
  const shellTask = await pollTask(token, shell.body.task.id);
  assert(shellTask.status === "completed" && shellTask.result.includes("codexbro uploaded file ok"), "shell task did not pull attached workspace file from the server");
  assert(shellTask.result.includes(".codexbro/task-workspaces/"), "shell task did not run inside an isolated task workspace");
  log("shell task completed");

  const artifact = await createTask(token, {
    workerId: worker.id,
    mode: "shell",
    prompt: "mkdir -p \"$CODEXBRO_TASK_ARTIFACT_DIR\" && printf \"codexbro artifact file ok\" > \"$CODEXBRO_TASK_ARTIFACT_DIR/screenshot.txt\" && printf artifact-task-done",
    workingDirectory: rootDir,
    idempotencyKey: "script-artifact"
  });
  const artifactTask = await pollTask(token, artifact.body.task.id);
  const returnedArtifact = artifactTask.artifacts.find((item) => item.name === "screenshot.txt");
  assert(artifactTask.status === "completed" && returnedArtifact, "task artifact was not returned");
  const artifactDownload = await fetch(`${baseUrl}${returnedArtifact.value}?token=${token}`);
  assert(artifactDownload.status === 200 && await artifactDownload.text() === "codexbro artifact file ok", "task artifact download did not match generated file");
  log("task artifact upload/download completed");

  const dangerous = await createTask(token, {
    workerId: worker.id,
    mode: "shell",
    prompt: "rm -rf ./definitely-not-present-codexbro-script-e2e",
    workingDirectory: rootDir,
    idempotencyKey: "script-approval"
  });
  const waitingTask = await waitFor(async () => {
    const task = await getTask(token, dangerous.body.task.id);
    return task.status === "waiting_user" ? task : null;
  }, "dangerous task did not pause for approval");
  assert(waitingTask.approvalRequest?.riskClass === "destructive", "approval metadata risk class missing");
  const approved = await json(`/api/tasks/${waitingTask.id}/approve`, {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({})
  });
  assert(approved.status === 200, `approval failed: ${JSON.stringify(approved.body)}`);
  const approvedTask = await pollTask(token, waitingTask.id);
  assert(approvedTask.status === "completed", "approved task did not complete");
  log("approval flow completed");

  const idempotent = await createTask(token, {
    workerId: worker.id,
    mode: "shell",
    prompt: "sleep 2 && printf codexbro-idempotent-ok",
    workingDirectory: rootDir,
    idempotencyKey: "script-idempotent"
  });
  const duplicate = await createTask(token, {
    workerId: worker.id,
    mode: "shell",
    prompt: "sleep 2 && printf codexbro-idempotent-ok",
    workingDirectory: rootDir,
    idempotencyKey: "script-idempotent"
  });
  assert(duplicate.status === 200 && duplicate.body.deduped === true, "duplicate task was not deduped");
  assert(duplicate.body.task.id === idempotent.body.task.id, "duplicate task id does not match original");
  const idempotentTask = await pollTask(token, idempotent.body.task.id);
  assert(idempotentTask.status === "completed", "idempotent task did not complete");
  log("idempotency flow completed");

  const retry = await json(`/api/tasks/${idempotentTask.id}/retry`, {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({})
  });
  assert(retry.status === 201, `retry failed: ${JSON.stringify(retry.body)}`);
  const retryTask = await pollTask(token, retry.body.task.id);
  assert(retryTask.status === "completed" && retryTask.attempt === idempotentTask.attempt + 1, "retry attempt did not complete correctly");
  log("manual retry completed");

  const rejectedBrowser = await json("/api/tasks", {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({
      workerId: worker.id,
      mode: "browser",
      prompt: "https://example.com",
      idempotencyKey: "script-browser-reject"
    })
  });
  assert(rejectedBrowser.status === 403 && rejectedBrowser.body.error.includes("browser"), "shell-only worker accepted browser task");
  log("worker mode permission rejected browser task");

  const browserPairing = await pairWorker(token, workspaceId);
  spawnProcess("browser-worker", "npm", [
    "--silent",
    "--workspace",
    "@codexbro/worker",
    "run",
    "dev",
    "--",
    "--server",
    baseUrl,
    "--pairing-token",
    browserPairing.pairingToken,
    "--token-file",
    path.join(dataDir, "browser-worker-token.json"),
    "--name",
    "CodexBro Browser E2E Worker",
    "--allowed-dir",
    rootDir,
    "--allowed-mode",
    "browser",
    "--allowed-mode",
    "computer",
    "--browser-profile-dir",
    path.join(dataDir, "browser-worker-profile")
  ], {
    CODEXBRO_CODEX_BIN: fakeCodexBin
  });
  const browserWorker = await waitFor(async () => {
    const response = await json("/api/workers", { headers: userHeaders(token) });
    return response.body.workers?.find((item) => item.name === "CodexBro Browser E2E Worker" && item.status === "online");
  }, "browser worker did not register");
  assert(JSON.stringify(browserWorker.allowedModes) === JSON.stringify(["browser", "computer"]), "browser worker did not register browser/computer modes");
  const browserTaskResponse = await createTask(token, {
    workerId: browserWorker.id,
    mode: "browser",
    browserSessionMode: "ephemeral",
    prompt: `${baseUrl}/api/health`,
    idempotencyKey: "script-browser-ephemeral"
  });
  const browserTask = await pollTask(token, browserTaskResponse.body.task.id, true, 30000);
  assert(browserTask.status === "completed", "ephemeral browser task did not complete");
  assert(browserTask.browserSessionMode === "ephemeral", "browser session mode was not persisted on the task");
  assert(browserTask.result.includes("fake codex exec ok"), "browser task did not invoke codex exec");
  assert(browserTask.result.includes("native Browser plugin"), "browser task did not request Codex Browser plugin");
  log("Codex browser plugin delegation completed");

  const computerTaskResponse = await createTask(token, {
    workerId: browserWorker.id,
    mode: "computer",
    browserSessionMode: "ephemeral",
    prompt: `Use computer mode to inspect ${baseUrl}/api/health`,
    idempotencyKey: "script-computer-ephemeral"
  });
  const computerTask = await pollTask(token, computerTaskResponse.body.task.id, true, 30000);
  assert(computerTask.status === "completed", "computer task did not complete");
  assert(computerTask.result.includes("fake codex exec ok"), "computer task did not invoke codex exec");
  assert(computerTask.result.includes("Codex's native Computer Use"), "computer task did not request Codex Computer Use");
  log("Codex Computer Use delegation completed");

  const unavailablePairing = await pairWorker(token, workspaceId);
  spawnProcess("unavailable-native-worker", "npm", [
    "--silent",
    "--workspace",
    "@codexbro/worker",
    "run",
    "dev",
    "--",
    "--server",
    baseUrl,
    "--pairing-token",
    unavailablePairing.pairingToken,
    "--token-file",
    path.join(dataDir, "unavailable-native-worker-token.json"),
    "--name",
    "CodexBro Unavailable Native E2E Worker",
    "--allowed-dir",
    rootDir,
    "--allowed-mode",
    "browser"
  ], {
    CODEXBRO_CODEX_BIN: fakeUnavailableCodexBin
  });
  const unavailableWorker = await waitFor(async () => {
    const response = await json("/api/workers", { headers: userHeaders(token) });
    return response.body.workers?.find((item) => item.name === "CodexBro Unavailable Native E2E Worker" && item.status === "online");
  }, "unavailable native worker did not register");
  const unavailableTaskResponse = await createTask(token, {
    workerId: unavailableWorker.id,
    mode: "browser",
    prompt: `${baseUrl}/api/health`,
    idempotencyKey: "script-browser-native-unavailable"
  });
  const unavailableTask = await pollTask(token, unavailableTaskResponse.body.task.id, true, 30000);
  assert(unavailableTask.status === "failed", "native browser unavailability should fail the task");
  assert(unavailableTask.error.includes("Codex Browser plugin is not available"), "native browser failure did not explain the unavailable tool channel");
  log("Codex native Browser unavailability is reported as a task failure");

  const unbindPairing = await pairWorker(token, workspaceId);
  const unbound = await registerWorker(unbindPairing.pairingToken, "CodexBro Unbind E2E Worker");
  const pendingUnbind = await createTask(token, {
    workerId: unbound.worker.id,
    mode: "shell",
    prompt: "printf should-not-run",
    workingDirectory: rootDir,
    idempotencyKey: "script-unbind"
  });
  const deletedWorker = await json(`/api/workers/${unbound.worker.id}`, {
    method: "DELETE",
    headers: userHeaders(token)
  });
  assert(deletedWorker.status === 200 && deletedWorker.body.revokedTokens === 1, `worker unbind failed: ${JSON.stringify(deletedWorker.body)}`);
  const workersAfterUnbind = await json("/api/workers", { headers: userHeaders(token) });
  assert(!workersAfterUnbind.body.workers?.some((item) => item.id === unbound.worker.id), "unbound worker still appears in worker list");
  const heartbeatAfterUnbind = await json("/api/worker/heartbeat", {
    method: "POST",
    headers: workerHeaders(unbound.workerToken),
    body: JSON.stringify({})
  });
  assert(heartbeatAfterUnbind.status === 401, "revoked worker token still accepted heartbeat");
  const failedUnbindTask = await getTask(token, pendingUnbind.body.task.id);
  assert(failedUnbindTask.status === "failed" && failedUnbindTask.error.includes("unbound"), "pending task did not fail when its worker was unbound");
  log("worker unbind revoked token and failed unfinished work");

  const rebindTokenFile = path.join(dataDir, "rebind-worker-token.json");
  writeFileSync(rebindTokenFile, JSON.stringify({
    server: baseUrl,
    workerToken: unbound.workerToken,
    workerId: unbound.worker.id,
    workerName: unbound.worker.name
  }));
  const rebindPairing = await pairWorker(token, workspaceId);
  spawnProcess("rebind-worker", "npm", [
    "--silent",
    "--workspace",
    "@codexbro/worker",
    "run",
    "dev",
    "--",
    "--server",
    baseUrl,
    "--pairing-token",
    rebindPairing.pairingToken,
    "--token-file",
    rebindTokenFile,
    "--name",
    "CodexBro Rebind E2E Worker",
    "--allowed-dir",
    rootDir,
    "--allowed-mode",
    "shell"
  ]);
  const reboundWorker = await waitFor(async () => {
    const response = await json("/api/workers", { headers: userHeaders(token) });
    return response.body.workers?.find((item) => item.name === "CodexBro Rebind E2E Worker" && item.status === "online");
  }, "worker did not rebind after saved token revocation");
  const reboundToken = JSON.parse(readFileSync(rebindTokenFile, "utf8"));
  assert(reboundToken.workerId === reboundWorker.id && reboundToken.workerToken !== unbound.workerToken, "rebind did not replace the revoked worker token file");
  log("worker rebind replaced a revoked saved token");

  const fakePairing = await pairWorker(token, workspaceId);
  const fake = await registerWorker(fakePairing.pairingToken, "CodexBro Stale E2E Worker");
  const stale = await createTask(token, {
    workerId: fake.worker.id,
    mode: "shell",
    prompt: "sleep 30",
    workingDirectory: rootDir,
    idempotencyKey: "script-stale"
  });
  const firstClaim = await json("/api/worker/tasks", { headers: workerHeaders(fake.workerToken) });
  assert(firstClaim.body.task?.id === stale.body.task.id && firstClaim.body.task.status === "running", "fake worker did not claim stale task");
  await new Promise((resolve) => setTimeout(resolve, 650));
  await json("/api/tasks", { headers: userHeaders(token) });
  const firstStale = await getTask(token, stale.body.task.id);
  assert(firstStale.status === "pending" && firstStale.attempt === 2 && firstStale.nextRunAt, "first stale did not requeue with backoff");
  const earlyClaim = await json("/api/worker/tasks", { headers: workerHeaders(fake.workerToken) });
  assert(earlyClaim.body.task === null, "fake worker claimed before backoff elapsed");
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(firstStale.nextRunAt) - Date.now()) + 200));
  const secondClaim = await json("/api/worker/tasks", { headers: workerHeaders(fake.workerToken) });
  assert(secondClaim.body.task?.id === stale.body.task.id && secondClaim.body.task.attempt === 2, "fake worker did not claim after backoff");
  await new Promise((resolve) => setTimeout(resolve, 650));
  await json("/api/tasks", { headers: userHeaders(token) });
  const failedStale = await getTask(token, stale.body.task.id);
  assert(failedStale.status === "failed" && failedStale.error.includes("2 attempts"), "stale task did not fail at retry limit");
  log("stale retry policy completed");

  const audit = await json("/api/audit", { headers: userHeaders(token) });
  assert(audit.body.audits?.some((event) => event.action === "task.requeued"), "audit did not include stale requeue");
  assert(audit.body.audits?.some((event) => event.action === "task.failed"), "audit did not include stale failure");

  const db = new DatabaseSync(path.join(dataDir, "data.sqlite"));
  const counts = Object.fromEntries(["users", "workspaces", "workspace_members", "workspace_prompt_templates", "workers", "tasks", "task_logs", "audits"].map((table) => [
    table,
    db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count
  ]));
  const staleRow = db.prepare("SELECT status, attempt, next_run_at, error FROM tasks WHERE id = ?").get(stale.body.task.id);
  const disabledRow = db.prepare("SELECT disabled_at FROM users WHERE email = ?").get("disabled@codexbro.local");
  db.close();
  assert(counts.users >= 3 && counts.workspaces >= 3 && counts.workspace_members >= 3 && counts.workspace_prompt_templates >= 1 && counts.workers >= 5 && counts.tasks >= 9, "sqlite counts did not match expected e2e state");
  assert(disabledRow?.disabled_at, "sqlite did not persist disabled customer state");
  assert(staleRow.status === "failed" && staleRow.attempt === 2, "sqlite stale row did not persist retry result");
  log(`sqlite persisted expected state: ${JSON.stringify(counts)}`);

  log("all checks passed");
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
    console.error(`[e2e] ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  })
  .finally(cleanup);

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const rootDir = process.cwd();
const dataDir = mkdtempSync(path.join(os.tmpdir(), "codexbro-ui-"));
const apiPort = await getFreePort();
const webPort = await getFreePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const processes = [];
let browserInstance;

function log(message) {
  console.log(`[ui] ${message}`);
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
  processes.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
}

async function waitFor(predicate, message, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(message);
}

async function api(pathname, token, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function seedWorker() {
  const login = await api("/api/auth/login", undefined, {
    method: "POST",
    body: JSON.stringify({ email: "founder@codexbro.local", password: "codexbro-demo" })
  });
  assert(login.status === 200, `seed login failed: ${JSON.stringify(login.body)}`);
  const adminToken = login.body.token;
  const created = await api("/api/admin/users", adminToken, {
    method: "POST",
    body: JSON.stringify({
      email: "ui-smoke@codexbro.local",
      password: "codexbro-ui",
      workspaceName: "UI Smoke Workspace",
      platformRole: "user",
      workspaceRole: "owner"
    })
  });
  assert(created.status === 201, `seed customer failed: ${JSON.stringify(created.body)}`);
  const customerLogin = await api("/api/auth/login", undefined, {
    method: "POST",
    body: JSON.stringify({ email: "ui-smoke@codexbro.local", password: "codexbro-ui" })
  });
  assert(customerLogin.status === 200, `seed customer login failed: ${JSON.stringify(customerLogin.body)}`);
  const token = customerLogin.body.token;
  const workspaces = await api("/api/workspaces", token);
  const workspaceId = workspaces.body.workspaces[0].id;
  const uploaded = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
      "x-file-name": encodeURIComponent("ui-smoke-brief.txt")
    },
    body: Buffer.from("ui smoke workspace file")
  });
  assert(uploaded.status === 201, `seed workspace file failed: ${await uploaded.text()}`);
  const pairing = await api("/api/workers/pairing-token", token, {
    method: "POST",
    body: JSON.stringify({ workspaceId })
  });
  assert(pairing.status === 200, `seed pairing failed: ${JSON.stringify(pairing.body)}`);
  const registered = await api("/api/worker/register", undefined, {
    method: "POST",
    body: JSON.stringify({
      pairingToken: pairing.body.pairingToken,
      name: "UI Smoke Worker",
      capabilities: ["shell", "browser"],
      allowedModes: ["shell", "browser"],
      allowedDirectories: [rootDir],
      browserProfileDir: path.join(dataDir, "browser-profile"),
      nativeReadiness: {
        backend: "desktop",
        codexCli: { ok: true, detail: "codex --version: ui smoke", checkedAt: new Date().toISOString() },
        codexDesktopBridge: { ok: true, status: "available", detail: "scriptExists=true submitSmoke=not-run", checkedAt: new Date().toISOString() },
        codexDesktopSmoke: { ok: true, status: "ready", detail: "submitSmoke=passed durationMs=1000", checkedAt: new Date().toISOString() },
        cuaDriver: { ok: true, detail: "permissions ok", checkedAt: new Date().toISOString() },
        chrome: { ok: false, detail: "not checked in ui smoke", checkedAt: new Date().toISOString() }
      }
    })
  });
  assert(registered.status === 201, `seed worker failed: ${JSON.stringify(registered.body)}`);
  const task = await api("/api/tasks", token, {
    method: "POST",
    body: JSON.stringify({
      workerId: registered.body.worker.id,
      mode: "browser",
      prompt: "Open https://example.com and report the heading.",
      workingDirectory: rootDir,
      idempotencyKey: "ui-smoke-progress-task"
    })
  });
  assert(task.status === 201, `seed task failed: ${JSON.stringify(task.body)}`);
  const claimed = await api("/api/worker/tasks", registered.body.workerToken);
  assert(claimed.status === 200 && claimed.body.task?.id === task.body.task.id, `seed task claim failed: ${JSON.stringify(claimed.body)}`);
  const progress = await api(`/api/worker/tasks/${task.body.task.id}/logs`, registered.body.workerToken, {
    method: "POST",
    body: JSON.stringify({
      level: "info",
      message: "[desktop progress] 正在打开或检查目标页面。"
    })
  });
  assert(progress.status === 201, `seed progress log failed: ${JSON.stringify(progress.body)}`);
}

async function loginThroughUi(page, email = "ui-smoke@codexbro.local", password = "codexbro-ui") {
  await page.goto(webUrl, { waitUntil: "networkidle" });
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.getByRole("heading", { name: "任务", exact: true }).waitFor({ timeout: 10000 });
}

async function logoutThroughUi(page, email) {
  await page.getByRole("button", { name: email, exact: true }).click();
  await page.getByRole("button", { name: "登录", exact: true }).waitFor({ timeout: 5000 });
}

async function assertNavFitsViewport(page, width) {
  for (const view of ["任务", "文件", "工作机", "审计", "设置"]) {
    const box = await page.getByRole("button", { name: view, exact: true }).boundingBox();
    assert(box, `${view} nav button is missing`);
    assert(box.x >= 0 && box.x + box.width <= width, `${view} nav button overflows the viewport`);
  }
}

async function main() {
  log(`temporary api=${apiUrl} web=${webUrl}`);
  spawnProcess("server", "npm", ["--silent", "--workspace", "@codexbro/server", "run", "dev"], {
    PORT: String(apiPort),
    HOST: "127.0.0.1",
    CODEXBRO_DATA_DIR: dataDir
  });

  await waitFor(async () => {
    try {
      return (await fetch(`${apiUrl}/api/health`)).ok;
    } catch {
      return false;
    }
  }, "api server did not become healthy");
  await seedWorker();
  log("seeded workspace and worker");

  spawnProcess("web", "npm", ["--silent", "--workspace", "@codexbro/web", "run", "dev", "--", "--host", "127.0.0.1"], {
    VITE_PORT: String(webPort),
    VITE_PROXY_API_TARGET: apiUrl
  });
  await waitFor(async () => {
    try {
      return (await fetch(webUrl)).ok;
    } catch {
      return false;
    }
  }, "web server did not become healthy");

  browserInstance = await chromium.launch({ headless: true });
  const page = await browserInstance.newPage({ viewport: { width: 1440, height: 1000 } });
  await loginThroughUi(page, "founder@codexbro.local", "codexbro-demo");
  await page.getByRole("button", { name: "管理后台", exact: true }).click();
  await page.getByRole("heading", { name: "管理后台", exact: true }).waitFor({ timeout: 5000 });
  assert(await page.getByRole("heading", { name: "创建客户", exact: true }).isVisible(), "admin create-customer form is not visible");
  assert(await page.getByText("客户账号", { exact: true }).isVisible(), "admin users list is not visible");
  await logoutThroughUi(page, "founder@codexbro.local");
  await loginThroughUi(page);
  assert(await page.getByRole("button", { name: "管理后台", exact: true }).count() === 0, "customer should not see admin nav");
  await page.getByRole("heading", { name: "任务对话", exact: true }).waitFor({ timeout: 5000 });
  await page.getByText("1 / 1").waitFor({ timeout: 5000 });
  assert(await page.getByText("1 / 1").isVisible(), "compact worker status is not visible");
  assert(await page.getByRole("heading", { name: "任务历史", exact: true }).isVisible(), "task history sidebar heading is missing");
  assert(await page.getByRole("button", { name: "新建任务", exact: true }).isVisible(), "new task history button is missing");
  await page.getByRole("button", { name: /Open https:\/\/example\.com/ }).click();
  assert(await page.getByText("执行概览", { exact: true }).isVisible(), "execution overview is not visible");
  assert(await page.getByText("执行信号", { exact: true }).isVisible(), "execution signal label is not visible");
  assert(await page.getByText("排队", { exact: true }).isVisible(), "execution queued phase is not visible");
  assert(await page.getByText("执行", { exact: true }).isVisible(), "execution running phase is not visible");
  assert(await page.getByText("进度时间线", { exact: true }).isVisible(), "progress timeline is not visible");
  await page.locator(".progress-timeline").getByText("正在打开或检查目标页面。", { exact: true }).waitFor({ timeout: 5000 });
  assert(await page.getByPlaceholder("输入任务，例如：检查这个项目并运行测试").isVisible(), "chat task input is missing");
  await page.locator(".composer-file-entry").click();
  await page.getByRole("heading", { name: "文件", exact: true }).waitFor({ timeout: 5000 });
  assert(await page.getByText("ui-smoke-brief.txt", { exact: true }).isVisible(), "composer file entry did not open workspace files");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("heading", { name: "任务对话", exact: true }).waitFor({ timeout: 5000 });
  assert(await page.getByRole("button", { name: "发送任务" }).isVisible(), "chat send button is missing");
  await page.getByText("提示词模板", { exact: true }).click();
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  await page.getByLabel("模板名称").fill("UI 自定义模板");
  await page.getByLabel("模板说明").fill("UI smoke custom template");
  await page.getByLabel("推荐模式").selectOption("computer");
  await page.getByLabel("模板内容").fill("任务：UI 自定义模板\\n只生成草稿，等待人工确认。");
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await page.getByRole("button", { name: /UI 自定义模板/ }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: /UI 自定义模板/ }).click();
  const taskPrompt = page.getByPlaceholder("输入任务，例如：检查这个项目并运行测试");
  assert((await taskPrompt.inputValue()).includes("任务：UI 自定义模板"), "custom prompt template did not fill the composer");
  await page.getByText("执行设置", { exact: true }).click();
  assert(await page.getByLabel("执行模式").inputValue() === "computer", "custom prompt template did not set computer mode");
  assert(await page.getByText("当前 worker 能力", { exact: true }).isVisible(), "selected worker capability summary is not visible");
  await page.getByRole("button", { name: /客户信息采集/ }).click();
  assert((await taskPrompt.inputValue()).includes("任务：客户信息采集"), "customer research prompt template did not fill the composer");

  await page.getByLabel("本地 Codex").selectOption({ label: "UI Smoke Worker" });
  const modeOptions = await page.getByLabel("执行模式").locator("option").allTextContents();
  assert(modeOptions.includes("Codex 浏览器插件"), "Codex browser plugin option is not visible");
  assert(modeOptions.includes("Codex Computer Use"), "Codex Computer Use option is not visible");
  assert(await page.getByLabel("执行模式").inputValue() === "browser", "prompt template did not set browser mode");
  await page.getByLabel("执行模式").selectOption("browser");
  await page.getByLabel("执行模式").selectOption("computer");

  for (const view of ["文件", "工作机", "审计", "设置", "任务"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.getByRole("heading", { name: view, exact: true }).waitFor({ timeout: 5000 });
    if (view === "文件") {
      await page.getByRole("heading", { name: "工作区文件", exact: true }).waitFor({ timeout: 5000 });
      assert(await page.getByText("ui-smoke-brief.txt", { exact: true }).isVisible(), "workspace file page does not list seeded file");
      await page.getByLabel("搜索文件").fill("brief");
      assert(await page.getByText("ui-smoke-brief.txt", { exact: true }).isVisible(), "workspace file search hid matching file");
      await page.getByLabel("搜索文件").fill("");
    }
    if (view === "工作机") {
      await page.getByRole("button", { name: "连接本地 Codex" }).click();
      await page.getByText("推荐启动命令", { exact: true }).waitFor({ timeout: 5000 });
      await page.getByText("原生能力自检", { exact: true }).waitFor({ timeout: 5000 });
      await page.getByText("能力检测", { exact: true }).waitFor({ timeout: 5000 });
      assert(await page.getByText("推荐启动命令", { exact: true }).isVisible(), "recommended worker command label is not visible");
      assert(await page.getByText("在线，可接任务", { exact: true }).isVisible(), "worker online capability status is not visible");
      assert((await page.locator("body").innerText()).includes("--token-file .codexbro/worker-token.json"), "recommended worker command does not include a token file");
      assert(await page.getByRole("button", { name: "解绑", exact: true }).isVisible(), "worker unbind button is not visible");
      assert(await page.getByText("Codex Desktop 派发已验证", { exact: true }).isVisible(), "desktop readiness summary is not visible");
      assert(await page.getByText("Desktop Smoke", { exact: true }).isVisible(), "Desktop Smoke readiness is not visible");
      assert(await page.getByText("CuaDriver", { exact: true }).isVisible(), "CuaDriver readiness is not visible");
      assert(await page.getByText("Chrome", { exact: true }).isVisible(), "Chrome readiness is not visible");
    }
    if (view === "设置") {
      assert((await page.locator("body").innerText()).includes("npm run doctor:desktop"), "desktop doctor command is not visible");
      assert((await page.locator("body").innerText()).includes("--token-file .codexbro/worker-token.json"), "settings launch command does not include a token file");
      await page.getByText("Desktop 启动检查", { exact: true }).waitFor({ timeout: 5000 });
      assert(await page.getByText("Desktop 后端已启用", { exact: true }).isVisible(), "desktop backend checklist item is not visible");
      assert(await page.getByText("Browser/Computer 模式已允许", { exact: true }).isVisible(), "browser/computer mode checklist item is not visible");
      assert(await page.getByText("Desktop Smoke 已验证", { exact: true }).isVisible(), "desktop smoke checklist item is not visible");
      assert(await page.getByText("CuaDriver 权限可用", { exact: true }).isVisible(), "CuaDriver checklist item is not visible");
    }
  }

  const text = await page.locator("body").innerText();
  assert(text.includes("派发任务给本地 Codex"), "Chinese tasks view text missing");
  await page.getByText("执行设置", { exact: true }).click();
  const workerOptions = await page.getByLabel("本地 Codex").locator("option").allTextContents();
  assert(workerOptions.includes("UI Smoke Worker"), "seeded worker missing from UI");

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("heading", { name: "Tasks", exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole("heading", { name: "Task conversation", exact: true }).waitFor({ timeout: 5000 });
  assert(await page.getByRole("heading", { name: "Task history", exact: true }).isVisible(), "English task history sidebar is missing");
  const englishText = await page.locator("body").innerText();
  assert(englishText.includes("Dispatch work to local Codex"), "English language toggle did not update page copy");
  assert(englishText.includes("Codex Browser plugin"), "English Codex browser option missing");
  await page.getByRole("button", { name: "中文" }).click();

  const mobilePage = await browserInstance.newPage({ viewport: { width: 390, height: 900 }, isMobile: true });
  await loginThroughUi(mobilePage);
  await assertNavFitsViewport(mobilePage, 390);

  await browserInstance.close();
  browserInstance = undefined;
  log("all checks passed");
}

async function cleanup() {
  await browserInstance?.close().catch(() => undefined);
  for (const child of processes.toReversed()) {
    if (!child.killed) child.kill("SIGINT");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(dataDir, { recursive: true, force: true });
}

main()
  .catch((error) => {
    console.error(`[ui] ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  })
  .finally(cleanup);

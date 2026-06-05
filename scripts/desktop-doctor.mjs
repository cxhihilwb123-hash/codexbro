#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const defaultCuaDriverBin = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const defaultChromeSkillRoot = path.join(os.homedir(), ".codex/plugins/cache/openai-bundled/chrome/26.601.21317");

const options = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

async function main() {
  if (options.help) {
    printHelp();
    return;
  }

  const report = await buildReport();
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printHumanReport(report);
}

function parseArgs(args) {
  const parsed = {
    cwd: process.cwd(),
    json: false,
    smoke: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--cwd" && next) {
      parsed.cwd = path.resolve(next);
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--smoke") {
      parsed.smoke = true;
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`CodexBro Desktop Doctor

Usage:
  npm run doctor:desktop
  npm run doctor:desktop -- --json
  CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true npm run doctor:desktop -- --smoke

Checks local readiness for CodexBro Browser/Computer tasks through Codex Desktop.
By default it avoids foreground task submission. Pass --smoke to run the real
Codex Desktop marker-file smoke check.
`);
}

async function buildReport() {
  const startedAt = new Date().toISOString();
  const cwd = options.cwd;
  const backend = process.env.CODEXBRO_NATIVE_TASK_BACKEND ?? (process.env.CODEXBRO_CODEX_BIN ? "exec" : "desktop");
  const codexCommand = process.env.CODEXBRO_CODEX_BIN ?? "codex";
  const appServerCommand = process.env.CODEXBRO_APP_SERVER_CODEX_BIN ?? process.env.CODEXBRO_CODEX_BIN ?? "codex";
  const bridgeScript = await resolveCodexDesktopBridgeScript(cwd);

  const checks = [
    await checkBoolean("platform", process.platform === "darwin", `platform=${process.platform}`, "Run Desktop bridge tasks from macOS."),
    await commandCheck("codexCli", `${codexCommand} --version`, codexCommand, ["--version"], cwd, "Install and sign in to Codex CLI/Desktop."),
    await commandCheck("codexAppServer", `${appServerCommand} app-server --help`, appServerCommand, ["app-server", "--help"], cwd, "Update Codex CLI if app-server is unavailable."),
    await checkBoolean("desktopBackend", backend === "desktop", `CODEXBRO_NATIVE_TASK_BACKEND=${backend}`, "Start the worker with CODEXBRO_NATIVE_TASK_BACKEND=desktop."),
    await checkBoolean("foregroundAllowed", process.env.CODEXBRO_DESKTOP_ALLOW_FOREGROUND === "true", `CODEXBRO_DESKTOP_ALLOW_FOREGROUND=${process.env.CODEXBRO_DESKTOP_ALLOW_FOREGROUND ?? "(unset)"}`, "Set CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true so CodexBro can submit into Codex Desktop with user-visible foreground dispatch."),
    await checkBoolean("desktopSmokeEnabled", process.env.CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS === "true" || options.smoke, `CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=${process.env.CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS ?? "(unset)"} smokeArg=${options.smoke}`, "Set CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true for worker readiness, or run doctor with --smoke."),
    await checkBoolean("desktopBridgeScript", await fileExists(bridgeScript), `script=${bridgeScript}`, "Run from the CodexBro repo or set CODEXBRO_DESKTOP_BRIDGE_SCRIPT."),
    await bridgeDiagnoseCheck(bridgeScript, cwd),
    await cuaDriverCheck(cwd),
    await chromeCheck(cwd),
    await smokeCheck(bridgeScript, cwd)
  ].filter(Boolean);

  const required = checks.filter((check) => check.required !== false);
  const ok = required.every((check) => check.ok);
  return {
    ok,
    startedAt,
    cwd,
    backend,
    bridgeScript,
    summary: ok ? "Desktop worker prerequisites look ready." : "Desktop worker setup needs attention.",
    checks
  };
}

async function checkBoolean(name, ok, detail, fix, required = true) {
  return {
    name,
    ok,
    status: ok ? "ready" : "needs_attention",
    detail,
    fix: ok ? "" : fix,
    required
  };
}

async function commandCheck(name, label, command, args, cwd, fix) {
  try {
    const output = await runQuiet(command, args, cwd, 12000);
    return {
      name,
      ok: true,
      status: "ready",
      detail: `${label}: ${(output || "ok").split(/\r?\n/)[0].slice(0, 180)}`,
      fix: "",
      required: name !== "codexAppServer"
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: name === "codexAppServer" ? "optional" : "needs_attention",
      detail: `${label}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      fix,
      required: name !== "codexAppServer"
    };
  }
}

async function bridgeDiagnoseCheck(script, cwd) {
  if (process.platform !== "darwin" || !await fileExists(script)) {
    return {
      name: "desktopBridgeDiagnose",
      ok: false,
      status: "needs_attention",
      detail: "diagnose skipped because platform or bridge script is unavailable",
      fix: "Fix platform/script checks first.",
      required: true
    };
  }

  const result = await runJsonCommand(process.execPath, [script, "diagnose", "--cwd", cwd], cwd, 45000);
  const report = result.json && typeof result.json === "object" ? result.json : undefined;
  const ok = result.code === 0 && report?.ok === true;
  return {
    name: "desktopBridgeDiagnose",
    ok,
    status: ok ? "ready" : "needs_attention",
    detail: ok
      ? `windowId=${report?.selectedWindow?.windowId ?? "unknown"} elementCount=${report?.snapshot?.elementCount ?? "unknown"}`
      : `diagnose failed: ${(result.stderr || result.stdout || `exit ${result.code}`).slice(0, 260)}`,
    fix: ok ? "" : "Open Codex Desktop, sign in, and grant CuaDriver Accessibility/Screen Recording permissions.",
    required: true
  };
}

async function cuaDriverCheck(cwd) {
  const command = process.env.CODEXBRO_CUA_DRIVER_BIN ?? defaultCuaDriverBin;
  try {
    const version = (await runQuiet(command, ["--version"], cwd, 12000)).split(/\r?\n/)[0] || "unknown";
    const permissions = await runQuiet(command, ["call", "check_permissions", JSON.stringify({ prompt: false })], cwd, 15000);
    const accessibilityGranted = /Accessibility:\s*granted/i.test(permissions);
    const screenRecordingGranted = /Screen Recording:\s*granted/i.test(permissions);
    const apps = await runJsonCommand(command, ["call", "list_apps", "{}"], cwd, 15000);
    const appCount = apps.code === 0 && Array.isArray(apps.json?.apps) ? apps.json.apps.length : 0;
    const ok = accessibilityGranted && screenRecordingGranted && appCount > 0;
    return {
      name: "cuaDriver",
      ok,
      status: ok ? "ready" : "needs_attention",
      detail: `bin=${command} version=${version} accessibilityGranted=${accessibilityGranted} screenRecordingGranted=${screenRecordingGranted} appCount=${appCount}`,
      fix: ok ? "" : "Install CuaDriver and grant Accessibility plus Screen Recording permissions in macOS Settings.",
      required: true
    };
  } catch (error) {
    return {
      name: "cuaDriver",
      ok: false,
      status: "needs_attention",
      detail: `bin=${command} ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      fix: "Install CuaDriver or set CODEXBRO_CUA_DRIVER_BIN to the cua-driver binary.",
      required: true
    };
  }
}

async function chromeCheck(cwd) {
  const chromeRoot = process.env.CODEXBRO_CHROME_SKILL_ROOT ?? defaultChromeSkillRoot;
  const scripts = {
    running: path.join(chromeRoot, "scripts", "chrome-is-running.js"),
    installed: path.join(chromeRoot, "scripts", "check-extension-installed.js"),
    manifest: path.join(chromeRoot, "scripts", "check-native-host-manifest.js")
  };
  if (!await fileExists(scripts.running) || !await fileExists(scripts.installed) || !await fileExists(scripts.manifest)) {
    return {
      name: "chrome",
      ok: false,
      status: "optional",
      detail: `Chrome skill scripts missing under ${chromeRoot}`,
      fix: "Chrome control is optional for Desktop bridge, but install/enable the Codex Chrome integration for authenticated Chrome tasks.",
      required: false
    };
  }
  const [running, installed, manifest] = await Promise.all([
    runJsonCommand(process.execPath, [scripts.running, "--json"], cwd, 15000),
    runJsonCommand(process.execPath, [scripts.installed, "--json"], cwd, 15000),
    runJsonCommand(process.execPath, [scripts.manifest, "--json"], cwd, 15000)
  ]);
  const chromeRunning = Boolean(running.json?.running);
  const extensionInstalled = Boolean(installed.json?.installed);
  const extensionEnabled = Boolean(installed.json?.enabled);
  const nativeHostCorrect = Boolean(manifest.json?.correct);
  const ok = chromeRunning && extensionInstalled && extensionEnabled && nativeHostCorrect;
  return {
    name: "chrome",
    ok,
    status: ok ? "ready" : "optional",
    detail: `running=${chromeRunning} extensionInstalled=${extensionInstalled} extensionEnabled=${extensionEnabled} nativeHostCorrect=${nativeHostCorrect}`,
    fix: ok ? "" : "Optional: open Chrome and enable the Codex extension/native host for Chrome-control tasks.",
    required: false
  };
}

async function smokeCheck(script, cwd) {
  if (!options.smoke && process.env.CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS !== "true") {
    return {
      name: "desktopSmoke",
      ok: false,
      status: "skipped",
      detail: "not run; pass --smoke or set CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true",
      fix: "Run CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true npm run doctor:desktop -- --smoke for end-to-end submission proof.",
      required: false
    };
  }
  if (process.env.CODEXBRO_DESKTOP_ALLOW_FOREGROUND !== "true") {
    return {
      name: "desktopSmoke",
      ok: false,
      status: "needs_attention",
      detail: "smoke requires CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true",
      fix: "Set CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true before running smoke.",
      required: true
    };
  }
  if (!await fileExists(script)) {
    return {
      name: "desktopSmoke",
      ok: false,
      status: "needs_attention",
      detail: `bridge script missing: ${script}`,
      fix: "Run from the CodexBro repo or set CODEXBRO_DESKTOP_BRIDGE_SCRIPT.",
      required: true
    };
  }

  const marker = `CODEXBRO_DESKTOP_DOCTOR_${Date.now()}`;
  const doneMarker = `${marker}_DONE`;
  const resultFile = path.join(cwd, ".codexbro", "desktop-readiness", `${marker}.md`);
  const timeoutMs = Number(process.env.CODEXBRO_DESKTOP_BRIDGE_SMOKE_TIMEOUT_MS ?? 180000);
  const prompt = [
    `${marker} This is a CodexBro Desktop doctor smoke test.`,
    `Create ${resultFile} containing exactly ${doneMarker} and no other text.`,
    "Do not do anything else."
  ].join(" ");
  const result = await runJsonCommand(process.execPath, [
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
  const ok = result.code === 0 && result.json?.ok === true && typeof result.json?.result === "string" && result.json.result.includes(doneMarker);
  return {
    name: "desktopSmoke",
    ok,
    status: ok ? "ready" : "needs_attention",
    detail: ok
      ? `submitSmoke=passed durationMs=${result.json?.durationMs ?? "unknown"} resultFileExists=${Boolean(result.json?.resultFileExists)}`
      : `submitSmoke=failed exit=${result.code} ${(result.json?.error ?? result.stderr ?? result.stdout).slice(0, 260)}`,
    fix: ok ? "" : "Keep Codex Desktop open and signed in, then rerun the smoke test.",
    required: true
  };
}

async function resolveCodexDesktopBridgeScript(cwd) {
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

function ancestorDirectories(start) {
  const directories = [];
  let current = path.resolve(start);
  for (;;) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

async function fileExists(filePath) {
  return stat(filePath).then((item) => item.isFile()).catch(() => false);
}

function runQuiet(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`${command} ${args[0] ?? ""} exited with code ${code}: ${stderr || stdout}`.trim()));
    });
  });
}

function runJsonCommand(command, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message, json: undefined });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

function printHumanReport(report) {
  console.log(`CodexBro Desktop Doctor`);
  console.log(`Status: ${report.ok ? "READY" : "NEEDS ATTENTION"}`);
  console.log(`CWD: ${report.cwd}`);
  console.log(`Backend: ${report.backend}`);
  console.log("");
  for (const check of report.checks) {
    const mark = check.ok ? "✓" : check.status === "skipped" ? "-" : check.required === false ? "!" : "✗";
    console.log(`${mark} ${check.name}: ${check.status}`);
    console.log(`  ${check.detail}`);
    if (check.fix) console.log(`  fix: ${check.fix}`);
  }
  console.log("");
  console.log(report.summary);
}

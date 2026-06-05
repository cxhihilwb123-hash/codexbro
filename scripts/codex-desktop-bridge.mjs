#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const defaultCuaDriverBin = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const codexBundleId = "com.openai.codex";

const options = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (options.command === "help" || options.help) {
    printHelp();
    return;
  }

  await ensureCuaDriverDaemon();

  if (options.command === "diagnose") {
    const report = await diagnose();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (options.command === "submit") {
    const report = await submit();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 2;
    return;
  }

  printHelp();
  process.exitCode = 1;
}

function parseArgs(args) {
  const parsed = {
    command: args[0] ?? "help",
    cwd: process.cwd(),
    prompt: "",
    marker: "",
    doneMarker: "",
    resultFile: "",
    diagnosticsDir: path.join(process.cwd(), ".codexbro", "desktop-bridge-diagnostics"),
    timeoutMs: 120000,
    pollMs: 4000,
    openWaitMs: 5000,
    sendXRatio: Number(process.env.CODEXBRO_DESKTOP_SEND_X_RATIO ?? 0.684),
    sendYRatio: Number(process.env.CODEXBRO_DESKTOP_SEND_Y_RATIO ?? 0.511),
    alternateSendYRatio: Number(process.env.CODEXBRO_DESKTOP_ALT_SEND_Y_RATIO ?? 0.526),
    composerXRatio: Number(process.env.CODEXBRO_DESKTOP_COMPOSER_X_RATIO ?? 0.5),
    composerYRatio: Number(process.env.CODEXBRO_DESKTOP_COMPOSER_Y_RATIO ?? 0.45),
    allowForeground: process.env.CODEXBRO_DESKTOP_ALLOW_FOREGROUND === "true",
    foregroundPaste: process.env.CODEXBRO_DESKTOP_FOREGROUND_PASTE !== "false",
    help: false
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--cwd" && next) {
      parsed.cwd = path.resolve(next);
      index += 1;
    } else if (arg === "--prompt" && next) {
      parsed.prompt = next;
      index += 1;
    } else if (arg === "--prompt-file" && next) {
      parsed.promptFile = path.resolve(next);
      index += 1;
    } else if (arg === "--marker" && next) {
      parsed.marker = next;
      index += 1;
    } else if (arg === "--done-marker" && next) {
      parsed.doneMarker = next;
      index += 1;
    } else if (arg === "--result-file" && next) {
      parsed.resultFile = path.resolve(next);
      index += 1;
    } else if (arg === "--diagnostics-dir" && next) {
      parsed.diagnosticsDir = path.resolve(next);
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      parsed.timeoutMs = Number(next);
      index += 1;
    } else if (arg === "--poll-ms" && next) {
      parsed.pollMs = Number(next);
      index += 1;
    } else if (arg === "--open-wait-ms" && next) {
      parsed.openWaitMs = Number(next);
      index += 1;
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Codex Desktop Bridge

Usage:
  node scripts/codex-desktop-bridge.mjs diagnose --cwd /path/to/project
  node scripts/codex-desktop-bridge.mjs submit --cwd /path/to/project --prompt "..." --marker CODEXBRO_TEST --done-marker CODEXBRO_TEST_DONE --result-file /path/result.md

The script uses CuaDriver only by default. Set CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true
to explicitly allow foreground Codex paste/submit dispatch.
`);
}

async function diagnose() {
  const startedAt = new Date().toISOString();
  const codex = await findCodexApp();
  const selected = codex.pid ? await findCodexWindow(codex.pid) : undefined;
  const snapshot = selected ? await getCodexWindowState(selected.pid, selected.windowId, "新对话").catch((error) => ({
    error: error instanceof Error ? error.message : String(error)
  })) : undefined;

  const report = {
    ok: Boolean(codex.pid && selected?.windowId && snapshot && !snapshot.error),
    startedAt,
    cwd: options.cwd,
    codex,
    selectedWindow: selected,
    snapshot: summarizeSnapshot(snapshot)
  };
  await writeDiagnostic("diagnose", report, snapshot);
  return report;
}

async function submit() {
  const prompt = await readPrompt();
  if (!prompt.trim()) {
    throw new Error("submit requires --prompt or --prompt-file.");
  }

  const marker = options.marker || firstToken(prompt);
  if (!marker) throw new Error("submit requires --marker, or a prompt whose first token is a marker.");
  const doneMarker = options.doneMarker || `${marker}_DONE`;
  const resultFile = options.resultFile || path.join(options.cwd, ".codexbro", "desktop-results", `${marker}.md`);
  await mkdir(path.dirname(resultFile), { recursive: true });

  const events = [];
  const startedAt = Date.now();
  events.push({ at: new Date().toISOString(), step: "start", marker, doneMarker, resultFile });

  const launch = await launchCodexDesktop(marker);
  events.push(launch.event);
  const foreground = await foregroundCodexIfAllowed();
  if (foreground) events.push(foreground);

  let target = launch.target;
  let markerVisible = launch.markerVisible;
  if (!target) {
    const codex = await findCodexApp(true);
    target = await findCodexWindow(codex.pid);
  }

  if (!target) {
    const report = failedReport(startedAt, events, "Codex Desktop is not running or no addressable window was found.");
    await writeDiagnostic("submit-failed-no-window", report);
    return report;
  }

  if (!markerVisible) {
    const fallback = await openComposerAndType(target.pid, target.windowId, options.cwd, prompt, marker);
    events.push(...fallback.events);
    markerVisible = fallback.ok;
    target = fallback.target ?? target;
  }

  if (!markerVisible) {
    const report = failedReport(startedAt, events, "Could not make the prompt marker visible in Codex Desktop composer.");
    await writeDiagnostic("submit-failed-no-marker", report);
    return report;
  }

  const sent = await sendComposer(target.pid, target.windowId, marker);
  events.push(...sent.events);
  if (!sent.ok) {
    const report = failedReport(startedAt, events, sent.error);
    await writeDiagnostic("submit-failed-send", report);
    return report;
  }

  const monitored = await monitorResult(target.pid, target.windowId, marker, doneMarker, resultFile, startedAt);
  events.push(...monitored.events);
  const report = {
    ok: monitored.ok,
    durationMs: Date.now() - startedAt,
    marker,
    doneMarker,
    resultFile,
    resultFileExists: monitored.resultFileExists,
    result: monitored.result,
    error: monitored.error,
    target,
    events
  };
  await writeDiagnostic(monitored.ok ? "submit-ok" : "submit-failed-monitor", report);
  return report;
}

async function readPrompt() {
  if (options.promptFile) return readFile(options.promptFile, "utf8");
  return options.prompt;
}

async function launchCodexDesktop(marker) {
  const event = { at: new Date().toISOString(), step: "launch-codex", ok: false, markerVisible: false };
  try {
    await cuaJson("launch_app", { bundle_id: codexBundleId });
    event.ok = true;
  } catch (error) {
    event.error = error instanceof Error ? error.message : String(error);
  }

  await wait(options.openWaitMs);
  const codex = await findCodexApp(true).catch((error) => {
    event.findAppError = error instanceof Error ? error.message : String(error);
    return undefined;
  });
  const target = codex?.pid ? await findCodexWindow(codex.pid).catch((error) => {
    event.findWindowError = error instanceof Error ? error.message : String(error);
    return undefined;
  }) : undefined;

  if (target) {
    const snapshot = await getCodexWindowState(target.pid, target.windowId).catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    }));
    event.snapshot = summarizeSnapshot(snapshot);
    event.markerVisible = Boolean(snapshot?.tree_markdown?.includes(marker));
    event.composerVisible = looksLikeCodexComposer(snapshot?.tree_markdown ?? "");
  }

  return { event, target, markerVisible: event.markerVisible };
}

async function foregroundCodexIfAllowed() {
  if (!options.allowForeground) return undefined;
  const event = { at: new Date().toISOString(), step: "foreground-codex", ok: false };
  try {
    await runQuiet("/usr/bin/osascript", ["-e", `tell application id "${codexBundleId}" to activate`]);
    await wait(500);
    event.ok = true;
  } catch (error) {
    event.error = error instanceof Error ? error.message : String(error);
  }
  return event;
}

async function openComposerAndType(pid, windowId, cwd, prompt, marker) {
  const events = [];
  const projectName = path.basename(cwd);
  const newThread = await findAndClickButton(pid, windowId, [
    new RegExp(`在 ${escapeRegExp(projectName)} 中开始新对话`),
    /新对话/,
    /New chat/i
  ], "open-project-thread");
  events.push(...newThread.events);
  if (!newThread.ok) return { ok: false, events };

  await wait(2500);
  const target = await findCodexWindow(pid).catch(() => ({ pid, windowId }));
  const text = await typeIntoComposer(target.pid, target.windowId, prompt, marker);
  events.push(...text.events);
  return { ok: text.ok, events, target };
}

async function findAndClickButton(pid, windowId, patterns, step) {
  const events = [];
  const snapshot = await getCodexWindowState(pid, windowId);
  const markdown = snapshot.tree_markdown ?? "";
  const index = findButtonIndex(markdown, patterns);
  events.push({ at: new Date().toISOString(), step, found: index !== undefined, elementIndex: index });
  if (index === undefined) return { ok: false, events };

  await cuaJson("click", { pid, window_id: windowId, element_index: index });
  await wait(1000);
  const after = await getCodexWindowState(pid, windowId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  events.push({ at: new Date().toISOString(), step: `${step}-after`, snapshot: summarizeSnapshot(after) });
  return { ok: true, events };
}

async function typeIntoComposer(pid, windowId, prompt, marker) {
  const events = [];
  const focused = await typeIntoFocusedComposer(pid, windowId, prompt, marker);
  events.push(...focused.events);
  if (focused.ok) return { ok: true, events };

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const snapshot = await getCodexWindowState(pid, windowId);
    const markdown = snapshot.tree_markdown ?? "";
    const textIndex = findElementIndex(markdown, /AXTextArea|AXTextField/);
    events.push({ at: new Date().toISOString(), step: "find-composer", attempt, found: textIndex !== undefined, elementIndex: textIndex });
    if (textIndex !== undefined) {
      await cuaJson("type_text", { pid, window_id: windowId, element_index: textIndex, text: prompt, delay_ms: 0 });
      await wait(1000);
      const after = await getCodexWindowState(pid, windowId);
      const markerVisible = Boolean(after.tree_markdown?.includes(marker));
      const composerVisible = looksLikeCodexComposer(after.tree_markdown ?? "");
      events.push({ at: new Date().toISOString(), step: "type-composer-after", markerVisible, snapshot: summarizeSnapshot(after) });
      return { ok: markerVisible || composerVisible, events };
    }
    await wait(1000);
  }
  return { ok: false, events };
}

async function typeIntoFocusedComposer(pid, windowId, prompt, marker) {
  const events = [];
  const before = await getCodexWindowState(pid, windowId);
  const composerVisibleBefore = looksLikeCodexComposer(before.tree_markdown ?? "");
  if (!composerVisibleBefore && !options.allowForeground) {
    return { ok: false, events };
  }
  events.push({
    at: new Date().toISOString(),
    step: "type-focused-composer-before",
    composerVisible: composerVisibleBefore,
    foregroundFallback: options.allowForeground && !composerVisibleBefore,
    snapshot: summarizeSnapshot(before)
  });

  const focused = await clickPixelComposer(pid, windowId);
  events.push(...focused.events);

  let inputOk = false;
  if (options.allowForeground && options.foregroundPaste) {
    const pasted = await pastePromptIntoForegroundCodex(pid, prompt);
    events.push(pasted.event);
    inputOk = pasted.ok;
  } else {
    await cuaJson("type_text", { pid, text: prompt, delay_ms: 0 });
    inputOk = true;
  }

  await wait(1000);
  const screenshotPath = path.join(options.diagnosticsDir, `type-after-${Date.now()}.jpg`);
  const after = await getCodexWindowState(pid, windowId, undefined, screenshotPath);
  const markerVisible = Boolean(after.tree_markdown?.includes(marker));
  const composerVisible = looksLikeCodexComposer(after.tree_markdown ?? "");
  events.push({
    at: new Date().toISOString(),
    step: "type-focused-composer-after",
    markerVisible,
    composerVisible,
    inputOk,
    screenshotPath,
    snapshot: summarizeSnapshot(after)
  });
  return { ok: markerVisible || (options.allowForeground && inputOk), events };
}

async function pastePromptIntoForegroundCodex(pid, prompt) {
  const event = { at: new Date().toISOString(), step: "paste-foreground-composer", ok: false };
  let previousClipboard;
  try {
    await clearForegroundComposer(pid);
    event.clearedComposer = true;
    previousClipboard = await runCapture("/usr/bin/pbpaste", [], { trim: false }).catch(() => undefined);
    await runWithStdin("/usr/bin/pbcopy", [], prompt);
    await cuaJson("hotkey", { pid, keys: ["cmd", "v"] });
    await wait(1000);
    event.ok = true;
  } catch (error) {
    event.error = error instanceof Error ? error.message : String(error);
    try {
      await runQuiet("/usr/bin/osascript", ["-e", 'tell application "System Events" to keystroke "v" using command down']);
      await wait(1000);
      event.ok = true;
      event.fallback = "system-events";
    } catch (fallbackError) {
      event.fallbackError = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    }
  } finally {
    if (previousClipboard !== undefined) {
      await runWithStdin("/usr/bin/pbcopy", [], previousClipboard).catch((error) => {
        event.restoreClipboardError = error instanceof Error ? error.message : String(error);
      });
    }
  }
  return { ok: event.ok, event };
}

async function clearForegroundComposer(pid) {
  try {
    await runQuiet("/usr/bin/osascript", ["-e", 'tell application "System Events" to key code 0 using command down']);
    await wait(200);
    await runQuiet("/usr/bin/osascript", ["-e", 'tell application "System Events" to key code 51']);
    await wait(200);
  } catch {
    await cuaJson("hotkey", { pid, keys: ["cmd", "a"] });
    await wait(200);
    await cuaJson("press_key", { pid, key: "delete" });
    await wait(200);
  }
}

async function sendComposer(pid, windowId, marker) {
  const events = [];
  if (options.allowForeground) {
    const pixelSent = await clickPixelSend(pid, windowId);
    events.push(...pixelSent.events);
    return pixelSent.ok ? { ok: true, events } : { ok: false, events, error: pixelSent.error };
  }

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const snapshot = await getCodexWindowState(pid, windowId);
    const markdown = snapshot.tree_markdown ?? "";
    if (looksLikeCodexComposer(markdown)) {
      const pixelSent = await clickPixelSend(pid, windowId);
      events.push(...pixelSent.events);
      return pixelSent.ok ? { ok: true, events } : { ok: false, events, error: pixelSent.error };
    }

    const sendIndex = findButtonIndex(markdown, [/发送/, /Send/i, /Submit/i, /Start/i, /运行/], [/发送任务/]);
    const textIndex = findElementIndex(markdown, /AXTextArea|AXTextField/);
    events.push({ at: new Date().toISOString(), step: "find-send", attempt, sendIndex, textIndex });
    if (sendIndex !== undefined) {
      await cuaJson("click", { pid, window_id: windowId, element_index: sendIndex });
      await wait(1500);
      const after = await getCodexWindowState(pid, windowId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
      events.push({ at: new Date().toISOString(), step: "send-after", snapshot: summarizeSnapshot(after) });
      return { ok: true, events };
    }
    if (textIndex !== undefined) {
      await cuaJson("press_key", { pid, window_id: windowId, element_index: textIndex, key: "return", modifiers: ["cmd"] });
      await wait(1500);
      const after = await getCodexWindowState(pid, windowId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
      events.push({ at: new Date().toISOString(), step: "send-hotkey-after", snapshot: summarizeSnapshot(after) });
      return { ok: true, events };
    }
    await wait(1000);
  }
  return { ok: false, events, error: "Could not find Codex Desktop send button or composer to submit." };
}

async function clickPixelComposer(pid, windowId) {
  const events = [];
  const screenshotPath = path.join(options.diagnosticsDir, `composer-${Date.now()}.jpg`);
  const snapshot = await getCodexWindowState(pid, windowId, undefined, screenshotPath);
  const width = snapshot.screenshot_width ?? 1568;
  const height = snapshot.screenshot_height ?? 806;
  const x = Math.round(width * options.composerXRatio);
  const y = Math.round(height * options.composerYRatio);
  events.push({ at: new Date().toISOString(), step: "pixel-composer-focus", x, y, width, height, screenshotPath });
  await cuaJson("click", {
    pid,
    window_id: windowId,
    x,
    y,
    debug_image_out: path.join(options.diagnosticsDir, `composer-click-${Date.now()}.png`)
  });
  await wait(500);
  return { ok: true, events };
}

async function clickPixelSend(pid, windowId) {
  const events = [];
  const screenshotPath = path.join(options.diagnosticsDir, `send-${Date.now()}.jpg`);
  const snapshot = await getCodexWindowState(pid, windowId, undefined, screenshotPath);
  const width = snapshot.screenshot_width ?? 1568;
  const height = snapshot.screenshot_height ?? 806;
  const x = Math.round(width * options.sendXRatio);
  const y = Math.round(height * options.sendYRatio);
  events.push({ at: new Date().toISOString(), step: "pixel-send", x, y, width, height, screenshotPath });
  await cuaJson("click", {
    pid,
    window_id: windowId,
    x,
    y,
    debug_image_out: path.join(options.diagnosticsDir, `send-click-${Date.now()}.png`)
  });
  await wait(2000);
  let after = await getCodexWindowState(pid, windowId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  if (looksLikeCodexComposer(after.tree_markdown ?? "") && options.alternateSendYRatio !== options.sendYRatio) {
    const alternateY = Math.round(height * options.alternateSendYRatio);
    events.push({ at: new Date().toISOString(), step: "pixel-send-alternate", x, y: alternateY, width, height, screenshotPath });
    await cuaJson("click", {
      pid,
      window_id: windowId,
      x,
      y: alternateY,
      debug_image_out: path.join(options.diagnosticsDir, `send-click-alt-${Date.now()}.png`)
    });
    await wait(2000);
    after = await getCodexWindowState(pid, windowId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  }
  if (options.allowForeground) {
    await runQuiet("/usr/bin/osascript", ["-e", 'tell application "System Events" to key code 36']);
    await wait(2500);
    after = await getCodexWindowState(pid, windowId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    events.push({ at: new Date().toISOString(), step: "send-foreground-return-after", snapshot: summarizeSnapshot(after) });
    return { ok: true, events };
  }
  await cuaJson("press_key", { pid, window_id: windowId, key: "return", modifiers: ["cmd"] });
  await wait(2000);
  after = await getCodexWindowState(pid, windowId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  events.push({ at: new Date().toISOString(), step: "send-cmd-return-after", snapshot: summarizeSnapshot(after) });
  await cuaJson("press_key", { pid, window_id: windowId, key: "return" });
  await wait(2000);
  after = await getCodexWindowState(pid, windowId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  events.push({ at: new Date().toISOString(), step: "send-return-after", snapshot: summarizeSnapshot(after) });
  events.push({ at: new Date().toISOString(), step: "pixel-send-after", snapshot: summarizeSnapshot(after) });
  return { ok: true, events };
}

async function monitorResult(pid, windowId, marker, doneMarker, resultFile, startedAt) {
  const events = [];
  let lastInteresting = "";
  while (Date.now() - startedAt < options.timeoutMs) {
    const resultFileExists = await fileExists(resultFile);
    const result = resultFileExists ? await readFile(resultFile, "utf8").catch(() => "") : "";
    const snapshot = await getCodexWindowStateWithRecovery(pid, windowId);
    const interesting = extractInteresting(snapshot.tree_markdown ?? "", marker, doneMarker);
    if (interesting.length) lastInteresting = interesting.at(-1);
    events.push({
      at: new Date().toISOString(),
      step: "monitor",
      resultFileExists,
      resultDone: result.includes(doneMarker),
      axDone: Boolean(snapshot.tree_markdown?.includes(doneMarker)),
      interesting: interesting.slice(-6)
    });

    if (result.includes(doneMarker) || snapshot.tree_markdown?.includes(doneMarker) || result.includes(marker)) {
      return {
        ok: true,
        events,
        resultFileExists,
        result: result.trim() || `Codex Desktop reported ${doneMarker}.`
      };
    }
    await wait(options.pollMs);
  }

  return {
    ok: false,
    events,
    resultFileExists: await fileExists(resultFile),
    result: "",
    error: `Timed out waiting for ${doneMarker}.${lastInteresting ? ` Last observed: ${lastInteresting}` : ""}`
  };
}

async function getCodexWindowStateWithRecovery(pid, windowId) {
  const first = await getCodexWindowState(pid, windowId).catch((error) => ({
    error: error instanceof Error ? error.message : String(error)
  }));
  if (!first.error) return first;

  await ensureCuaDriverDaemon().catch(() => undefined);
  return getCodexWindowState(pid, windowId).catch((error) => ({
    error: error instanceof Error ? error.message : String(error)
  }));
}

async function findCodexApp(launchIfMissing = false) {
  const listed = await cuaJson("list_apps", {});
  let app = listed.apps?.find((item) => item.bundle_id === codexBundleId);
  if ((!app?.running || !app.pid) && launchIfMissing) {
    const launched = await cuaJson("launch_app", { bundle_id: codexBundleId });
    app = { ...(app ?? {}), running: true, pid: launched.pid, bundle_id: codexBundleId, name: "Codex" };
  }
  return {
    bundleId: app?.bundle_id ?? codexBundleId,
    name: app?.name ?? "Codex",
    pid: app?.pid,
    running: Boolean(app?.running)
  };
}

async function findCodexWindow(pid) {
  const windows = await cuaJson("list_windows", { pid, on_screen_only: false });
  const candidates = (windows.windows ?? [])
    .filter((window) => window.window_id && (window.bounds?.width ?? 0) > 300 && (window.bounds?.height ?? 0) > 300)
    .sort((a, b) => windowScore(b) - windowScore(a));
  const window = candidates[0];
  if (!window) return undefined;
  return {
    pid,
    windowId: window.window_id,
    title: window.title,
    bounds: window.bounds,
    isOnScreen: window.is_on_screen,
    onCurrentSpace: window.on_current_space
  };
}

function windowScore(window) {
  return (
    (window.is_on_screen ? 1000 : 0) +
    (window.on_current_space ? 1000 : 0) +
    (window.title === "Codex" ? 100 : 0) +
    Math.min(100, Math.floor(((window.bounds?.width ?? 0) * (window.bounds?.height ?? 0)) / 100000))
  );
}

async function getCodexWindowState(pid, windowId, query, screenshotOutFile) {
  return cuaJson("get_window_state", {
    pid,
    window_id: windowId,
    ...(query ? { query } : {}),
    ...(screenshotOutFile ? { screenshot_out_file: screenshotOutFile } : {})
  });
}

function findButtonIndex(markdown, include, exclude = []) {
  const lines = markdown.split("\n");
  for (const includePattern of include) {
    for (const line of lines) {
      if (!line.includes("AXButton")) continue;
      if (exclude.some((excludePattern) => excludePattern.test(line))) continue;
      if (!includePattern.test(line)) continue;
      const match = line.match(/\[(\d+)\]/);
      if (match) return Number(match[1]);
    }
  }
  return undefined;
}

function findElementIndex(markdown, pattern) {
  for (const line of markdown.split("\n")) {
    if (!pattern.test(line)) continue;
    const match = line.match(/\[(\d+)\]/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function summarizeSnapshot(snapshot) {
  if (!snapshot) return undefined;
  if (snapshot.error) return { error: snapshot.error };
  const markdown = snapshot.tree_markdown ?? "";
  return {
    elementCount: snapshot.element_count,
    hasNewChat: markdown.includes("新对话") || /New chat/i.test(markdown),
    hasTextInput: /AXTextArea|AXTextField/.test(markdown),
    hasSendButton: /AXButton.*(发送|Send|Submit|Start|运行)/i.test(markdown),
    treePreview: markdown.split("\n").slice(0, 40).join("\n")
  };
}

function looksLikeCodexComposer(markdown) {
  return (markdown.includes("我们应该在 ") && markdown.includes(" 中构建什么？")) ||
    /What should we build/i.test(markdown) ||
    /Ask Codex/i.test(markdown);
}

function extractInteresting(markdown, marker, doneMarker) {
  const terms = [marker, doneMarker, "Computer", "Browser", "完成", "成功", "失败", "限制", "验证码", "登录", "运行"];
  return markdown
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => terms.some((term) => line.includes(term)))
    .slice(-20);
}

function failedReport(startedAt, events, error) {
  return {
    ok: false,
    durationMs: Date.now() - startedAt,
    error,
    events
  };
}

async function writeDiagnostic(name, report, snapshot) {
  await mkdir(options.diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(options.diagnosticsDir, `${stamp}-${name}.json`);
  await writeFile(file, JSON.stringify({ report, snapshot }, null, 2));
}

async function cuaJson(tool, payload) {
  const output = await runQuiet(cuaBin(), ["call", tool, JSON.stringify(payload)]);
  try {
    return JSON.parse(output || "{}");
  } catch {
    if (/^(✅|Performed|Typed|Pressed|Clicked)/.test(output.trim())) return {};
    throw new Error(`Could not parse cua-driver ${tool} output: ${output.slice(0, 1000)}`);
  }
}

async function ensureCuaDriverDaemon() {
  if (await commandSucceeds(cuaBin(), ["status"])) return;
  const child = spawn(cuaBin(), ["serve"], {
    detached: true,
    env: process.env,
    stdio: "ignore"
  });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(500);
    if (await commandSucceeds(cuaBin(), ["status"])) return;
  }
  throw new Error("Could not start cua-driver daemon.");
}

function cuaBin() {
  return process.env.CODEXBRO_CUA_DRIVER_BIN ?? defaultCuaDriverBin;
}

function runQuiet(command, args) {
  return runCapture(command, args, { trim: true });
}

function runCapture(command, args, { trim } = { trim: true }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(trim ? stdout.trim() : stdout);
        return;
      }
      reject(new Error(`${command} ${args[0] ?? ""} exited with code ${code}: ${stderr || stdout}`.trim()));
    });
  });
}

function runWithStdin(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd: options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
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
    child.stdin.end(input);
  });
}

async function commandSucceeds(command, args) {
  return runQuiet(command, args).then(() => true).catch(() => false);
}

async function fileExists(filePath) {
  return stat(filePath).then((item) => item.isFile()).catch(() => false);
}

function firstToken(value) {
  return value.trim().split(/\s+/, 1)[0] ?? "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

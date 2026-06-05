import net from "node:net";
import { readdir, stat } from "node:fs/promises";
import { endianness, homedir, platform } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CodexAppServerClient } from "../packages/worker/dist/codex-app-server.js";

const cwd = path.resolve(process.argv[2] ?? process.cwd());
const codexCommand = process.env.CODEXBRO_APP_SERVER_CODEX_BIN ?? process.env.CODEXBRO_CODEX_BIN ?? "codex";
const chromePluginRoot = process.env.CODEXBRO_CHROME_SKILL_ROOT
  ? path.resolve(process.env.CODEXBRO_CHROME_SKILL_ROOT, "../..")
  : path.join(homedir(), ".codex/plugins/cache/openai-bundled/chrome/26.601.21317");
const browserClientPath = path.join(chromePluginRoot, "scripts", "browser-client.mjs");

const report = {
  cwd,
  codexCommand,
  browserClientPath,
  startedAt: new Date().toISOString(),
  skills: undefined,
  appServerProbe: undefined,
  nativeSockets: await inspectNativeSockets()
};

const client = new CodexAppServerClient({
  command: codexCommand,
  args: ["app-server"],
  cwd,
  requestTimeoutMs: 30000,
  onStderr: () => undefined
});

try {
  await client.start();
  const skillsResult = await client.request("skills/list", { cwds: [cwd], forceReload: true }, 30000);
  const skills = (skillsResult.data ?? []).flatMap((entry) => entry.skills ?? []);
  report.skills = {
    total: skills.length,
    browser: skills
      .filter((skill) => skill.name === "browser:control-in-app-browser" || skill.name === "chrome:control-chrome")
      .map((skill) => ({ name: skill.name, path: skill.path ?? null }))
  };

  const threadResult = await client.request("thread/start", {
    cwd,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    ephemeral: true
  }, 30000);
  const threadId = threadResult.thread?.id;
  if (!threadId) throw new Error("codex app-server did not return a thread id");

  const result = await client.request("mcpServer/tool/call", {
    threadId,
    server: "node_repl",
    tool: "js",
    arguments: {
      code: browserProbeCode(browserClientPath),
      timeout_ms: 20000,
      title: "CodexBro native browser probe"
    },
    _meta: {
      "x-codex-turn-metadata": {
        session_id: threadId,
        thread_id: threadId,
        thread_source: "codexbro-probe",
        turn_id: `codexbro-native-browser-probe-${Date.now()}`
      }
    }
  }, 26000);

  const text = extractMcpText(result);
  report.appServerProbe = {
    threadId,
    parsed: parseProbeMarker(text),
    discoveryFailures: text
      .split(/\r?\n/)
      .filter((line) => !line.includes("CODEXBRO_NATIVE_BROWSER_PROBE "))
      .filter((line) => /IAB_DISCOVERY|pipe-connect|native pipe|Connection refused|Browser is not available/i.test(line))
      .map((line) => line.trim().replace(/\s+/g, " ").slice(0, 300))
      .slice(0, 8)
  };
} catch (error) {
  report.appServerProbe = {
    error: error instanceof Error ? error.message : String(error)
  };
} finally {
  client.destroy();
}

console.log(JSON.stringify(report, null, 2));

function browserProbeCode(browserClient) {
  const url = pathToFileURL(browserClient).href;
  return `
await (async () => {
  const probe = {
    browserCount: 0,
    backendCounts: {},
    extensionReachable: false,
    iabReachable: false,
    nodeReplKeys: Object.keys(globalThis.nodeRepl ?? {}),
    hasNativePipe: Boolean(globalThis.nodeRepl?.nativePipe),
    hasCreateConnection: typeof globalThis.nodeRepl?.nativePipe?.createConnection === "function",
    requestMeta: globalThis.nodeRepl?.requestMeta ?? null,
    infos: []
  };
  try {
    const { setupBrowserRuntime } = await import(${JSON.stringify(url)});
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
    try { await agent.browsers.get("extension"); probe.extensionReachable = true; }
    catch (error) { probe.extensionError = error instanceof Error ? error.message : String(error); }
    try { await agent.browsers.get("iab"); probe.iabReachable = true; }
    catch (error) { probe.iabError = error instanceof Error ? error.message : String(error); }
  } catch (error) {
    probe.error = error instanceof Error ? error.message : String(error);
  }
  console.log("CODEXBRO_NATIVE_BROWSER_PROBE " + JSON.stringify(probe));
})();
`.trim();
}

async function inspectNativeSockets() {
  if (platform() === "win32") return { directory: "\\\\.\\pipe\\codex-browser-use", recent: [] };
  const directory = "/tmp/codex-browser-use";
  let files = [];
  try {
    files = await readdir(directory);
  } catch (error) {
    return { directory, error: error instanceof Error ? error.message : String(error), recent: [] };
  }

  const entries = (await Promise.all(files
    .filter((name) => name.endsWith(".sock"))
    .map(async (name) => {
      const full = path.join(directory, name);
      const item = await stat(full);
      return {
        path: full,
        name,
        mode: (item.mode & 0o777).toString(8),
        mtime: item.mtime.toISOString(),
        mtimeMs: item.mtimeMs
      };
    })))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const recent = [];
  for (const entry of entries.slice(0, 8)) {
    recent.push(await probeSocket(entry));
  }
  return { directory, count: entries.length, recent };
}

function probeSocket(entry) {
  return new Promise((resolve) => {
    const socket = net.createConnection(entry.path);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(socketResult(entry, false, "timeout"));
    }, 1200);
    socket.on("connect", () => {
      socket.end();
      clearTimeout(timer);
      resolve(socketResult(entry, true));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      resolve(socketResult(entry, false, error.message));
    });
  });
}

function socketResult(entry, connectable, error) {
  return {
    name: entry.name,
    mode: entry.mode,
    mtime: entry.mtime,
    connectable,
    ...(error ? { error } : {})
  };
}

function extractMcpText(value) {
  const content = value?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => typeof item?.text === "string" ? item.text : "")
    .filter(Boolean)
    .join("\n");
}

function parseProbeMarker(text) {
  const marker = "CODEXBRO_NATIVE_BROWSER_PROBE ";
  const line = text.split(/\r?\n/).find((item) => item.includes(marker));
  if (!line) return undefined;
  try {
    return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
  } catch {
    return undefined;
  }
}

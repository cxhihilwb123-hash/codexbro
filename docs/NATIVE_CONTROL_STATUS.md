# Native Control Status

This note records the current state of using local Codex native browser and computer-control capabilities through CodexBro.

## Verified Facts

- `codex app-server` is reachable from the worker and can start threads/turns over JSON-RPC.
- Worker-launched `codex app-server` can list native skills such as Browser, Chrome, and CuaDriver skills.
- Listing a skill is not the same as having the native runtime backend attached.
- In the current local setup, the Browser Use runtime probe from a worker-launched app-server reports no controllable browser backend. A deeper probe showed `pipe-connect/Error: failed to connect native pipe: Connection refused (os error 61)`, `browserCount=0`, `extensionReachable=false`, and `iabReachable=false`.
- The same `browser-client` probe succeeds inside the active Codex Desktop session and discovers both Chrome Extension and Codex In-app Browser backends. That means Chrome/plugin installation is not the blocker; the blocker is the worker-launched app-server's native-pipe/runtime attachment.
- Codex Desktop has an internal app-server bridge behind Electron IPC, but the Desktop app does not expose a local TCP or DevTools endpoint by default.
- The Desktop bundle contains existing-thread deep links shaped like `codex://threads/<conversationId>`.
- A new-thread deep link that carries `path` and `prompt` was not found in the Desktop bundle.
- The Desktop bridge can launch Codex, snapshot the window through CuaDriver, find the project/new-chat UI, and fill the composer.
- The tested Codex Desktop build does not expose a reliable accessibility send button or text area for background prompt submission.
- The practical Desktop dispatch path is to ask for user-level consent once, set `CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true`, briefly foreground Codex, clear the composer, paste the task, submit with a foreground Return key event, then monitor the result marker/file. Set `CODEXBRO_DESKTOP_FOREGROUND_PASTE=false` only for debugging the older CuaDriver typing path.
- This foreground-dispatch path passed an end-to-end smoke on 2026-06-04 by asking local Codex Desktop to create `.codexbro/desktop-results/foreground-autosend-smoke-20260604.md` with `CODEXBRO_FOREGROUND_AUTOSEND_SMOKE_20260604_DONE`.
- The same foreground-dispatch path passed a native browser-control smoke on 2026-06-04 by asking local Codex Desktop to use browser control on `https://example.com/` and write `.codexbro/desktop-results/browser-control-smoke-20260604.md` with `CODEXBRO_BROWSER_CONTROL_SMOKE_20260604_DONE` and `Example Domain`.
- The same foreground-dispatch path passed a native computer-control smoke on 2026-06-04 by asking local Codex Desktop to inspect the local Codex app/window state and write `.codexbro/desktop-results/computer-control-smoke-20260604.md` with `CODEXBRO_COMPUTER_CONTROL_SMOKE_20260604_DONE` and `Codex / Codex`.
- Worker native readiness now has a separate optional Desktop Smoke check. Set `CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true` with `CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true` to prove the chatbox bridge with a real marker-file task instead of only checking that the bridge script exists.

## Current Product Strategy

- Keep `app-server` as the primary experimental backend for native browser/computer work because it is the cleanest protocol path.
- Require a browser runtime probe before browser tasks claim native control is available.
- Require CuaDriver preflight before computer tasks claim native desktop control is available.
- Keep native failures visible by default. Only use `CODEXBRO_APP_SERVER_FALLBACK` or `CODEXBRO_DESKTOP_FALLBACK` when explicitly testing fallbacks.
- Treat default Desktop Bridge readiness as diagnostic, not proof of end-to-end task submission. Use the optional Desktop Smoke readiness check when the question is whether the chatbox bridge can really run a task.
- Use `npm run probe:native-browser -- /path/to/project` to reproduce the raw app-server Browser Use runtime probe and socket summary.
- For the Desktop-chatbox route, prefer an explicit foreground-dispatch mode over background-only AX typing. Background dispatch is too dependent on current focus state.

## Not Suitable Yet

- Do not claim worker-launched raw `codex app-server` can control the in-app browser just because it lists browser skills.
- Do not rely on `codex://threads/new?path=...&prompt=...`; this route has not been found in the Desktop app.
- Do not mark background-only Desktop Bridge as production-ready for browser/computer tasks. The foreground-dispatch bridge is usable with clear user consent and task/result markers, but it visibly foregrounds Codex during submission.

## Next Implementation Priorities

1. Confirm whether worker-launched app-server can be given the same native-pipe attachment as Codex Desktop's own runtime. The current evidence points to no, because pipe discovery sees refused stale/unavailable pipes and no browser backends.
2. Continue separating installed/static readiness from runtime-probe readiness as new native checks are added.
3. If raw app-server cannot receive that attachment, design a small supported Desktop-side bridge instead of accessibility-driven submission.

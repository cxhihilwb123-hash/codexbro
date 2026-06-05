# Desktop Bridge E2E

This runbook verifies the full CodexBro Desktop path:

1. Start a temporary CodexBro API server.
2. Pair a local worker with the Desktop backend enabled.
3. Run Desktop Smoke readiness through the Codex Desktop chatbox bridge.
4. Create a Browser task through the API and wait for the result to return.
5. Confirm Desktop bridge progress lines are streamed into task logs.
6. Create a Computer task through the API and wait for the result to return.

## Requirements

- macOS.
- Codex Desktop installed and signed in.
- CuaDriver installed with Accessibility and Screen Recording permissions.
- Browser/Computer capabilities available inside the active Codex Desktop session.
- The user is okay with Codex Desktop briefly coming to the foreground during task submission.

## Command

```bash
npm run test:desktop-e2e
```

The script uses a temporary `.codexbro` data directory under the system temp folder. It does not reuse the main local CodexBro SQLite database.

## What Passes

- The worker registers with `backend=desktop`.
- `codexDesktopSmoke.ok` is `true`.
- A Browser task opens `https://example.com/` through local Codex and returns `Example Domain`.
- A Computer task inspects the local Codex Desktop app/window state and returns `Codex`.
- Browser and Computer tasks emit `[desktop progress]` task logs while the bridge is running.

## Useful Environment Overrides

```bash
CODEXBRO_DESKTOP_BRIDGE_SMOKE_TIMEOUT_MS=180000
CODEXBRO_DESKTOP_TIMEOUT_MS=360000
CODEXBRO_DESKTOP_POLL_MS=5000
CODEXBRO_DESKTOP_PROGRESS_POLL_MS=1000
```

These are already set by the script for the spawned worker. Override them only when debugging a slower local machine.

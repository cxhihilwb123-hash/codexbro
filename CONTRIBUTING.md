# Contributing to CodexBro

Thanks for helping make CodexBro easier to run, inspect, and maintain.

CodexBro is an experimental local-execution control plane. Contributions should keep local execution explicit, auditable, and bounded by worker allowlists and user approvals.

## Development

```bash
npm ci
npm run check
npm run build
npm run test:e2e
npm run test:ui
```

`npm run test:desktop-e2e` is opt-in and requires macOS, Codex Desktop, CuaDriver permissions, and a signed-in local Codex session.

## Pull Requests

- Keep diffs small and focused.
- Add or update tests when behavior changes.
- Update documentation for new environment variables, worker behavior, task modes, or security boundaries.
- Do not commit `.codexbro/`, databases, worker tokens, screenshots with real accounts, logs, or private customer data.
- Prefer explicit allowlists and approval prompts over hidden automation.

## Good First Contributions

Good first issues usually live in documentation, UI clarity, CI, and diagnostics. Desktop automation and native bridge changes are higher risk and should include a clear local verification note.


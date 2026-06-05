# Architecture

CodexBro has four workspaces:

- `packages/web`: React/Vite console for tasks, workers, files, audits, settings, and admin provisioning.
- `packages/server`: Express API, SQLite persistence, task queue, workspace auth, worker registry, SSE task streams, and artifact storage.
- `packages/worker`: Local worker CLI that pairs with the server, claims tasks, enforces allowlists, runs shell/Codex/native tasks, and reports logs/results.
- `packages/shared`: Shared protocol and domain types.

## Control Flow

1. A user signs in to the web console.
2. The server creates a one-time pairing token for a workspace.
3. A local worker registers with that token and receives a long-lived worker token.
4. The web console creates a task for an online worker.
5. The worker claims the task, executes it within its allowlist, streams logs, and uploads artifacts.
6. The server records task lifecycle events, logs, audits, files, and results.

## Native Control

Shell and standard Codex tasks are the stable core. Browser and computer-control tasks are experimental and depend on local Codex/Codex Desktop/CuaDriver readiness. See `docs/NATIVE_CONTROL_STATUS.md`.


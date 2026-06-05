# Changelog

## v0.1.1 - 2026-06-05

Open-source maintenance release.

- Added GitHub Actions CI for install, typecheck, and build.
- Added README CI badge.
- Tracked follow-up work for deterministic E2E and UI smoke coverage on GitHub runners.

## v0.1.0 - 2026-06-05

Initial open-source release candidate.

- Web console for task conversations, worker status, files, audits, settings, and admin provisioning.
- Local worker CLI with pairing tokens, persisted worker tokens, task claiming, allowlists, approvals, cancellation, retry, and stale recovery.
- SQLite-backed server with workspaces, members, tasks, logs, files, prompt templates, workers, tokens, audits, and artifacts.
- Experimental Codex Browser/Computer delegation through app-server, exec, and Desktop bridge paths.
- Automated `check`, `build`, E2E, UI smoke, and opt-in Desktop E2E workflows.

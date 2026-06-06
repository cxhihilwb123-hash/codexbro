# Threat Model

CodexBro is local-execution infrastructure. Its core promise is not that tasks are harmless, but that execution is explicit, scoped, observable, and revocable.

## Assets

CodexBro should protect:

- Source code and files inside local workspaces.
- Worker tokens and session tokens.
- Workspace files uploaded to the server.
- Task logs, approvals, results, and artifacts.
- Browser sessions and desktop state when experimental native modes are used.
- SQLite data and `.codexbro/` runtime directories.

## Trust Boundaries

### Web Console

The web console is a user-facing control surface. It can create tasks, upload files, approve paused work, download artifacts, and inspect audit records.

### Server

The server is the control plane. It stores users, sessions, workspaces, pairing tokens, worker tokens, tasks, task logs, audits, workspace files, prompt templates, and artifacts.

If the server is deployed remotely, anything uploaded to it should be treated as data entrusted to that deployment.

### Local Worker

The local worker is the execution boundary. It should be started with the smallest practical:

- `--allowed-dir`
- `--allowed-mode`
- token file path
- native backend settings

The worker can execute commands and invoke Codex/native task paths according to its configured modes.

### Codex / Native Backends

Codex CLI, `codex app-server`, Codex Desktop, Browser plugin, Chrome integration, CuaDriver, and Computer Use are external capabilities. CodexBro probes readiness and reports failures, but it does not make those backends intrinsically safe.

## Main Risks

### Overbroad Local Access

Risk: a worker launched with a broad `--allowed-dir` can read or modify more local files than intended.

Mitigations:

- Use narrow project-specific allowlists.
- Run separate workers for separate trust zones.
- Keep task workspaces isolated under `.codexbro/task-workspaces/`.

### Token Leakage

Risk: worker tokens or session tokens are committed, logged, copied into artifacts, or exposed through screenshots.

Mitigations:

- Keep `.codexbro/` ignored.
- Store worker tokens with owner-only permissions where possible.
- Revoke worker tokens by unbinding workers.
- Do not put tokens in task output directories.

### Unsafe Browser or Desktop Automation

Risk: Browser/Computer tasks may act on authenticated sessions, private pages, or desktop apps.

Mitigations:

- Treat Browser/Computer modes as experimental.
- Require clear user intent before final external actions.
- Stop on CAPTCHA, login, payment, account changes, or missing permissions unless explicitly authorized.
- Prefer explicit progress/result files for Desktop bridge work.

### Prompt Injection Through Web Pages or Files

Risk: a webpage, email, document, or uploaded file instructs the agent to ignore user intent, exfiltrate data, or perform unrelated actions.

Mitigations:

- Treat external content as untrusted input.
- Keep user task instructions and system boundaries above page/file content.
- Restrict attached files to task-scoped manifests and local input directories.
- Return only files intentionally saved under the task output directory.

### Server Data Exposure

Risk: workspace files, logs, or artifacts on the server are accessible to the wrong user or workspace.

Mitigations:

- Enforce workspace membership checks.
- Keep artifacts and file downloads authenticated.
- Audit task and worker lifecycle events.
- Avoid self-signup in default SaaS-style flows.

## Out of Scope

CodexBro does not try to:

- Bypass CAPTCHA, paywalls, platform risk controls, or account security checks.
- Provide a hardened multi-tenant hosted SaaS by default.
- Guarantee safety of arbitrary shell commands.
- Reverse engineer or expose proprietary Codex Desktop internals.
- Replace endpoint security, sandboxing, backups, monitoring, or organization policy.

## Recommended Deployment Posture

For serious use:

- Run the server behind HTTPS.
- Change default admin credentials.
- Use a persistent and backed-up `CODEXBRO_DATA_DIR`.
- Keep workers on trusted machines.
- Scope each worker to one project or one trust zone.
- Keep Browser/Computer modes opt-in.
- Review logs and audit records.
- Rotate/revoke worker tokens when machines or users change.


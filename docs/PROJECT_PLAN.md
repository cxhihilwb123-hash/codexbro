# CodexBro Project Plan

## Product Goal

CodexBro is a SaaS-style control plane for local Codex execution. A user signs in through the web app, pairs a local worker, uploads workspace-scoped files, sends tasks from a Codex-style conversation, and watches worker logs, approvals, results, and artifacts stream back into that task thread.

## MVP Scope

The MVP proves the core loop:

1. User can sign in.
2. User can create a pairing token.
3. Local worker can register with the pairing token.
4. Web app can create a task for a selected worker.
5. Worker can claim and execute the task.
6. Logs stream back to the task detail view.
7. Completed result is visible in the web app.
8. Dangerous shell commands pause for approval before execution.
9. Browser and computer-use tasks are delegated to Codex's native Browser plugin or Computer Use capability through `codex exec`.
10. Key lifecycle events are visible in an audit trail.
11. Users can cancel pending, approval-waiting, or running tasks.
12. Running tasks survive worker disconnects by returning stale work to the queue.
13. Duplicate task-create requests with the same idempotency key return the active task instead of creating another run.
14. Finished tasks can be retried as a new attempt linked to the original task.
15. Approval prompts expose risk class, action, command, and working directory.
16. Server state persists to normalized SQLite tables by default instead of the original JSON file.
17. Users work inside default workspaces with role-based access to workers and tasks.
18. Workers can restrict accepted task modes independently from their broad capability list.
19. Stale task recovery uses capped retry attempts and exponential backoff.
20. API origin, public worker pairing URL, bind host, and web API base URL can be configured for deployment.
21. The local connector does not implement a separate Playwright browser controller for user tasks.
22. The web console has repeatable UI smoke coverage for login, navigation, task conversation rendering, local Codex selection, and Codex Browser/Computer mode controls.
23. The web console defaults to Chinese and supports Chinese/English switching.
24. The Tasks view uses a Codex-style workspace with task history, per-task conversation feedback, and a bottom composer for new work.
25. Users can upload files into their workspace and attach those files to tasks so workers and Codex can use them.
26. Users can browse workspace files from a dedicated Files view with search, upload, download, and delete actions.
27. Local machine binding has a real lifecycle: one-time pairing token, persisted worker token, server-side token revocation, and unfinished-task cleanup on unbind.
28. Platform admins provision customer accounts; customers do not self-register in the default SaaS flow.
29. The task composer provides lightweight prompt templates for customer research, low-risk engagement, and content publishing, with human-confirmation boundaries instead of a separate social automation engine.
30. Customers can create, edit, delete, and reuse server-side custom prompt templates scoped to their workspace.
31. The web console makes live execution progress, local worker capability, and Browser/Computer approval gates visible before and during task execution.

## Current Architecture

- `packages/web`: React/Vite SaaS console.
- `packages/server`: Express API, SQLite-backed control plane, task queue, worker registry, realtime SSE.
- `packages/worker`: Local CLI worker that polls the server and executes tasks.
- `packages/shared`: Shared protocol types for tasks, workers, logs, artifacts, and auth.
- `assets/concepts/codexbro-dashboard-concept.png`: Visual reference for the operator console.

## Implemented

- Email/password sign-in for provisioned local accounts.
- Bootstrapped platform-admin account through `CODEXBRO_ADMIN_EMAIL` / `CODEXBRO_ADMIN_PASSWORD`.
- Self-signup disabled by default, with `CODEXBRO_ALLOW_SELF_SIGNUP=true` available for local/demo compatibility.
- Platform Admin view for creating customer users, creating their initial workspace, resetting passwords, and disabling or enabling accounts.
- Session-token API auth for the web console.
- Pairing-token generation for local workers.
- One-time pairing tokens with 30-minute expiry.
- Worker registration, heartbeat, and online/offline status.
- Worker token persistence through `.codexbro/worker-token.json` or `CODEXBRO_WORKER_TOKEN_FILE`, allowing a bound local connector to restart without a fresh pairing token.
- Workers page unbind action that removes the local connector, revokes its worker tokens, audits the event, and fails unfinished tasks assigned to that connector.
- Task creation with `shell`, `codex`, `browser`, and `computer` modes in the protocol.
- Shell execution through the local worker.
- Codex CLI execution bridge through `codex exec`.
- Browser and computer-use execution delegated through `codex exec` with native-tool prompts.
- Default workspace creation on first login.
- Workspace roles for `owner`, `admin`, `operator`, and `viewer`.
- Workspace-scoped pairing tokens, workers, tasks, logs, artifacts, approvals, cancellation, and retry.
- Workspace-scoped file uploads, file listing, file download, and deletion.
- Dedicated Files view for simple drive-like workspace file browsing, search, upload, download, and delete.
- Task attachments through `attachedFileIds`, with task-scoped server download endpoints for workers.
- Prompt templates in the task composer for customer research, low-risk engagement, and content publishing. Templates fill the prompt and recommended task mode while keeping login, CAPTCHA, comments, DMs, payments, and final publishing behind human confirmation.
- Workspace-scoped custom prompt template CRUD, persisted in SQLite and available from the task composer.
- Shell and Codex tasks receive file metadata, authenticated download URLs, and `CODEXBRO_WORKER_TOKEN`/`CODEXBRO_TASK_FILES_JSON` environment context so files can be pulled from the server only when needed.
- Worker-level task-mode allowlists through `--allowed-mode`.
- Realtime task stream over SSE.
- Task logs, status updates, completion result, and failure handling.
- Approval gate for destructive-looking shell commands.
- Worker directory allowlists for shell and Codex task working directories.
- Task cancellation with worker-side interruption for shell, Codex, browser, and computer tasks.
- Running-task heartbeat while the worker is busy.
- Stale running-task recovery when a worker disconnects.
- Stale recovery retry limits through `CODEXBRO_STALE_MAX_ATTEMPTS`.
- Stale recovery backoff through `CODEXBRO_STALE_RETRY_BACKOFF_MS` and task `nextRunAt`.
- Production-oriented environment settings through `.env.example`, `CODEXBRO_PUBLIC_SERVER_URL`, `CODEXBRO_CORS_ORIGIN`, `HOST`, and `VITE_CODEXBRO_API_URL`.
- Automated Node E2E coverage through `npm run test:e2e` for API, worker, queue, approval, retry, permissions, Codex Browser/Computer delegation, stale recovery, audits, and SQLite persistence.
- Automated UI smoke coverage through `npm run test:ui` for the React/Vite console.
- Idempotent task creation through `idempotencyKey`.
- Task retry endpoint with `attempt` and `parentTaskId`.
- Structured approval metadata for risky shell commands.
- SQLite-backed persistence at `.codexbro/data.sqlite` using Node's built-in `node:sqlite`.
- Normalized SQLite tables for users, sessions, workspaces, workspace members, pairing tokens, worker tokens, workers, tasks, task logs, audits, and artifact file indexes.
- JSON fallback with `CODEXBRO_STORAGE=json`.
- Durable file artifacts stored under `.codexbro/artifacts`.
- Audit events for login, pairing-token creation, worker registration, task creation, task claim, approval, completion, and failure.
- SaaS console UI with Tasks, Workers, Audit, and Settings views.
- Codex-style Tasks workspace with task history, request bubbles, worker feedback, approval prompts, results, artifacts, and a bottom composer.
- Task conversation promotes worker status and Desktop progress logs into an execution overview with a compact progress timeline, while preserving raw logs for debugging.
- Task conversation shows a queued/claimed/executing/confirmation/result phase strip, live signal counters, latest worker message, and clearer approval cards for paused Browser/Computer or local execution actions.
- Worker tasks run in isolated local task workspaces under `.codexbro/task-workspaces/<taskId>/attempt-<n>/`; server workspace files are copied into `input/`, temporary files belong in `scratch/`, and screenshots, generated images, exports, and other files saved to `output/` are uploaded as task artifacts with image previews.
- Worker cards expose a Shell/Codex/Browser/Computer capability matrix, and the task composer summarizes whether the selected local worker can accept the selected mode.
- Settings includes a Desktop launch checklist that turns worker readiness into concrete setup gates for backend, allowed task modes, Desktop Bridge, Desktop Smoke, CuaDriver, and Chrome.
- Historical task logs load when a task is selected, then realtime SSE continues appending new worker feedback.
- Chinese-first UI copy with an EN toggle persisted in local storage.
- Admin-only navigation item for the platform management console; ordinary customers do not see or access it.
- Optional worker-triggered Desktop Smoke readiness check through `CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true`, proving the Codex Desktop chatbox bridge with a real marker-file task when foreground dispatch is explicitly enabled.
- Desktop bridge Browser/Computer tasks write a progress-file instruction into the local Codex prompt; the worker polls that file and streams new lines back as `[desktop progress]` task logs before final completion.
- Pairing-token responses include a recommended Desktop worker launch command that enables the desktop backend, foreground dispatch, Desktop Smoke readiness, and all task modes needed for Shell, Codex, Browser, and Computer work.
- Pairing-token responses include `--token-file .codexbro/worker-token.json` so generated launch commands produce a reusable local binding.
- `npm run doctor:desktop` provides a local preflight for Desktop worker setup, with human-readable output, `--json`, and optional `--smoke` foreground marker-file verification.

## Verification Evidence

- `npm run check` passes for shared, server, worker, and web.
- `npm run build` passes for shared, server, worker, and web.
- `npm run test:e2e` passes with a temporary server and a real worker CLI.
- `npm run test:ui` passes with a temporary API server, temporary Vite server, seeded worker, and Playwright UI checks.
- API health endpoint responds at `http://localhost:4317/api/health`.
- Worker registration was verified with a real pairing token.
- Shell task `printf "codexbro-e2e-ok\n" && pwd` completed and returned stdout/result.
- Dangerous shell task `rm -rf ./definitely-not-present-codexbro-test` paused in `waiting_user`, then completed after approval.
- Shell task `printf "allowlist-ok\n" && pwd` completed inside `/Users/forkman03/Documents/codexbro`.
- Shell task with working directory `/Users/forkman03` failed with `Working directory is outside this worker's allowlist`.
- Browser task delegation through `codex exec` was verified with a fake Codex binary that receives the native Browser plugin prompt.
- Audit endpoint returned recent task lifecycle events.
- Long shell task `sleep 20 && printf "should-not-print\n"` moved `running -> canceling -> canceled` after user cancellation, and did not print the trailing output.
- Stale recovery test on `PORT=4318` with `CODEXBRO_STALE_WORKER_MS=2000` requeued a running task after the worker process was stopped.
- Duplicate task-create requests with `qa-idempotency-key-1` returned the same task id and `deduped: true`.
- Retrying the completed idempotency test created attempt `2` linked to the original task and completed successfully.
- Dangerous command `rm -rf ./definitely-not-present-approval-metadata` paused with approval metadata: `riskClass=destructive`, `action=shell.command`, command, and working directory.
- SQLite storage test on `PORT=4319` completed a worker shell task and wrote `/tmp/codexbro-sqlite-test/data.sqlite`.
- SQLite snapshot inspection showed 1 user, 1 worker, 1 task, 6 logs, and 6 audits persisted.
- Relational SQLite test on `PORT=4320` completed a worker shell task, then table inspection showed rows in users, sessions, pairing_tokens, worker_tokens, workers, tasks, task_logs, audits, schema_meta, and kv_store.
- Restarting the `PORT=4320` server against the same data directory loaded the completed task from relational tables.
- Workspace permission test on `PORT=4321` created a default workspace with owner role, registered a worker with `--allowed-mode shell`, and confirmed the API exposed `allowedModes=["shell"]`.
- The same `PORT=4321` test completed shell task `printf codexbro-shell-ok-2`, rejected a browser task with `403 Worker does not allow browser tasks`, and persisted workspace IDs plus `allowed_modes="[\"shell\"]"` in SQLite.
- Main `.codexbro/data.sqlite` migration was verified after restart; the API returned the owner workspace and online worker, SQLite rows were backfilled with `workspace_id`, and shell task `printf main-restart-ok` completed on the restarted main worker.
- Stale retry policy test on `PORT=4322` with `CODEXBRO_STALE_WORKER_MS=500`, `CODEXBRO_STALE_MAX_ATTEMPTS=2`, and `CODEXBRO_STALE_RETRY_BACKOFF_MS=800` requeued a stale task as attempt `2`, blocked worker claim before `nextRunAt`, allowed claim after the backoff, then failed the task after the second stale attempt.
- Production config test on `PORT=4323` with `HOST=127.0.0.1`, `CODEXBRO_PUBLIC_SERVER_URL=https://api.codexbro.example`, and `CODEXBRO_CORS_ORIGIN=https://app.codexbro.example` generated a worker pairing command using the configured public API URL.
- Automated E2E script verified login, default owner workspace creation, real shell-only worker pairing, shell completion, dangerous-command approval metadata and approval execution, idempotent create dedupe, manual retry, browser-mode rejection on a shell-only worker, Codex Browser/Computer delegation through `codex exec`, stale retry/backoff failure limit, audit events, and SQLite table counts.
- Automated E2E script verified workspace file upload/list/download and confirmed a real worker can pull an attached file from the server through the task-scoped download URL.
- In-app Browser verification opened `http://localhost:5173`, logged in as `founder@codexbro.local`, and verified the Codex-style Tasks workspace with a task-history sidebar and main conversation.
- UI smoke script verified the login screen, seeded local Codex selection, task history, task conversation heading, task composer, Codex Browser/Computer mode options, exact headings for Tasks, Workers, Audit, and Settings, and mobile nav buttons fitting within a 390px viewport.
- UI smoke script seeds a running Browser task with `[desktop progress]` feedback and verifies the execution overview promotes that progress into the task timeline.
- UI smoke script verifies the Desktop launch checklist renders the key backend, Browser/Computer mode, Desktop Smoke, and CuaDriver setup gates.
- UI smoke script verifies default Chinese copy and switching back to English.
- In-app Browser verification opened `http://localhost:5173`, confirmed the Chinese Codex-style Tasks workspace renders with task history, task conversation, worker feedback, result bubble, bottom composer, and no relevant console errors.
- Screenshot artifacts were generated and visually inspected at `assets/verification/ui-smoke-dashboard.png` and `assets/verification/ui-smoke-mobile.png`; the mobile pass fixed a navigation truncation issue found at 390px width.
- Final runtime audit confirmed API health, online main worker, and shell task `printf completion-audit-ok` completing through the live `http://localhost:4317` server.
- Workers page UI smoke verifies the optional Desktop Smoke readiness item renders separately from static Desktop Bridge readiness.
- API and UI smoke coverage verify the recommended Desktop worker launch command and the higher-level Codex Desktop dispatch status summary.
- Automated E2E script verifies pairing-token reuse is rejected, worker token files are persisted with owner-only permissions, unbinding a worker revokes its worker token, old heartbeats fail with 401, unfinished tasks assigned to that worker become failed, and a worker can rebind with a new pairing token after its saved token was revoked.
- UI smoke script verifies the Workers page exposes the unbind action and generated launch commands include `--token-file .codexbro/worker-token.json`.
- Automated E2E script verifies unknown emails cannot self-register, the bootstrapped platform admin can create customer accounts, ordinary customers cannot access `/api/admin/users`, disabled customers cannot log in, and disabled state persists to SQLite.
- UI smoke script verifies the Admin navigation and create-customer form are visible to the platform admin, then verifies the same Admin navigation is hidden from a customer login.
- UI smoke script verifies the Files navigation, workspace file listing, and file search.
- Automated E2E script verifies workspace prompt template create, list, update, delete, and SQLite persistence.
- UI smoke script verifies built-in and custom prompt templates fill the task composer and select the expected mode.
- UI smoke script verifies clearer execution signals, selected-worker capability feedback, and Workers page capability detection.
- Desktop doctor was added as a non-failing diagnostic command; `npm run doctor:desktop -- --json` returns structured readiness checks for automation.
- `npm run test:desktop-e2e` provides an opt-in macOS acceptance test for the full API -> worker -> Codex Desktop bridge -> Browser/Computer task -> API result path.

In-app Browser screenshot capture still times out on `Page.captureScreenshot`, but screenshot-based visual evidence was captured through the project Playwright smoke path after Browser interaction verification succeeded.

## Next Stage

1. Keep expanding browser/UI coverage as new product surfaces are added.

# Comparison

CodexBro overlaps with several categories, but it is not a direct clone of any one of them.

## Codex CLI

Codex CLI is terminal-first and works directly in a local repository.

CodexBro adds:

- web task history
- worker pairing
- workspace files
- approvals
- audit logs
- artifact return
- multi-user/workspace control-plane concepts

CodexBro still depends on local Codex-style execution for many task modes.

## Plain Chat UI

A plain chat UI usually focuses on prompt/response interaction.

CodexBro focuses on execution lifecycle:

- selecting a local worker
- enforcing allowed directories and modes
- streaming logs
- pausing for approvals
- retrying/canceling tasks
- collecting artifacts
- recording audits

## CI Runner

A CI runner executes jobs from repository events.

CodexBro is interactive and user-directed:

- tasks are created from a web console
- workers can be paired/unbound at runtime
- approval prompts can pause execution
- attached workspace files can be task-scoped
- results flow back into a conversation UI

CI remains better for deterministic build/test pipelines.

## Remote Desktop

Remote desktop exposes a full interactive machine.

CodexBro tries to expose a narrower task surface:

- user sends a task
- local worker executes inside configured boundaries
- logs and artifacts return to the web app
- risky actions can pause for confirmation

Experimental Computer/Browser modes may still interact with real desktop or browser state, so they should be treated carefully.

## Hosted Agent Platform

Hosted agent platforms can run work remotely without local setup.

CodexBro's design point is different: keep execution on a trusted local worker while using a web control plane for coordination, visibility, and auditability.


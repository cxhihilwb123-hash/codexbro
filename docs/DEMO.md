# Demo Walkthrough

This walkthrough shows the smallest useful CodexBro loop: start the app, create a customer workspace, pair a local worker, run a task, and inspect the result.

## 1. Start the App

```bash
npm ci
npm run dev
```

Open:

```text
http://localhost:5173
```

Development defaults:

```text
founder@codexbro.local
codexbro-demo
```

## 2. Create a Customer

1. Sign in as the platform admin.
2. Open the Admin view.
3. Create a customer user and initial workspace.
4. Sign out and sign back in as the customer.

## 3. Pair a Local Worker

1. Open the Workers view.
2. Create a pairing token.
3. Start a worker with the generated command.

For a shell-only demo:

```bash
npm run worker -- \
  --server http://localhost:4317 \
  --pairing-token <token> \
  --token-file .codexbro/worker-token.json \
  --allowed-dir "$PWD" \
  --allowed-mode shell
```

## 4. Run a Task

Open the Tasks view and send a simple Shell task:

```text
pwd && npm run check
```

CodexBro should show:

- queued task state
- worker claim
- running logs
- completion result
- audit events

## 5. Return an Artifact

Send a task that writes a file to the task artifact directory:

```bash
mkdir -p "$CODEXBRO_TASK_ARTIFACT_DIR"
printf "hello from CodexBro\n" > "$CODEXBRO_TASK_ARTIFACT_DIR/demo.txt"
printf "artifact written"
```

After completion, the artifact should appear in the task conversation and Artifacts panel.

## Optional: Desktop Readiness

Desktop bridge work is macOS-specific and experimental.

```bash
npm run doctor:desktop
```

For a foreground smoke test:

```bash
CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true npm run doctor:desktop -- --smoke
```

Only enable Browser/Computer tasks when the local user understands that the worker may interact with real browser sessions and desktop apps.


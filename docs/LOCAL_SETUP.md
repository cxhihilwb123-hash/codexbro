# Local Setup

## Requirements

- Node.js 22 or newer.
- npm.
- Optional for Desktop bridge work: macOS, Codex Desktop, Codex CLI, CuaDriver, and required macOS permissions.

## Install

```bash
npm ci
```

## Run

```bash
npm run dev
```

Open `http://localhost:5173`.

Development defaults:

- Admin email: `founder@codexbro.local`
- Admin password: `codexbro-demo`
- API server: `http://localhost:4317`
- Web console: `http://localhost:5173`

## Verify

```bash
npm run check
npm run build
npm run test:e2e
npm run test:ui
```

Desktop E2E is local and opt-in:

```bash
npm run test:desktop-e2e
```


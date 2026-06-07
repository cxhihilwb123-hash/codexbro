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

## Troubleshooting

### API or web port is already in use

CodexBro uses `http://localhost:4317` for the API server and `http://localhost:5173` for the web console by default. If `npm run dev` reports that a port is already in use, stop the old development process or change the ports with `PORT` and `VITE_PORT` in your environment.

### Node.js version mismatch

Use Node.js 22 or newer. If install, build, or TypeScript commands fail on an older runtime, check the active version with `node --version`, switch to Node.js 22+, then run `npm ci` again.

### SQLite data location

The server stores local SQLite data under `.codexbro/data.sqlite` by default. Set `CODEXBRO_DATA_DIR=/path/to/data` when you want the database and runtime artifacts somewhere else.

### Reset local demo data safely

Stop `npm run dev` before deleting local demo data. Then remove the local `.codexbro/` directory, or remove the directory pointed to by `CODEXBRO_DATA_DIR`, and restart the dev server to recreate a fresh demo database.

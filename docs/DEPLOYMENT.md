# Deployment

CodexBro currently targets self-hosted and local development deployments.

## Server Settings

Use `.env.example` as the starting point. Important settings include:

- `PORT`
- `HOST`
- `CODEXBRO_PUBLIC_SERVER_URL`
- `CODEXBRO_CORS_ORIGIN`
- `CODEXBRO_DATA_DIR`
- `CODEXBRO_STORAGE`
- `CODEXBRO_ADMIN_EMAIL`
- `CODEXBRO_ADMIN_PASSWORD`
- `CODEXBRO_BOOTSTRAP_ADMIN`

## Data

The default SQLite database and runtime artifacts live under `.codexbro/`. Do not commit that directory.

For a persistent server, set `CODEXBRO_DATA_DIR` to a durable path and back it up according to your operational needs.

## Worker Trust Boundary

Workers execute tasks on local machines. Deployments should treat each worker as a trusted connector scoped by `--allowed-dir` and `--allowed-mode`.


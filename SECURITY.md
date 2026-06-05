# Security Policy

CodexBro can dispatch work to a local machine. Treat it as security-sensitive infrastructure.

## Supported Versions

Security reports are currently accepted for the latest `main` branch and the latest tagged release.

## Reporting a Vulnerability

Please use GitHub private vulnerability reporting when available:

https://github.com/cxhihilwb123-hash/codexbro/security/advisories/new

If that is unavailable, open a minimal public issue that says you have a security report, without including exploit details.

## Security Model

- Workers should be started with the narrowest practical `--allowed-dir`.
- Pairing tokens are one-time bootstrap credentials.
- Worker tokens are long-lived local credentials and should stay in `.codexbro/worker-token.json` or another ignored path.
- Shell and Codex tasks are constrained to the worker allowlist.
- Browser and computer-control tasks are experimental and may interact with local apps or authenticated browser sessions.
- Destructive or high-risk actions should remain behind explicit approval prompts.

## Do Not Commit

- `.env` files with real secrets.
- `.codexbro/` runtime data, SQLite databases, artifacts, logs, or worker tokens.
- Screenshots containing real customer data, account names, emails, phone numbers, payment details, or private workspace content.
- Extracted proprietary application bundles or reverse-engineered code.


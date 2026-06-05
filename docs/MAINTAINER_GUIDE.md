# Maintainer Guide

## Release Checklist

1. Confirm `npm ci` succeeds from a clean checkout.
2. Run `npm run check`.
3. Run `npm run build`.
4. Run `npm run test:e2e`.
5. Run `npm run test:ui`.
6. Update `CHANGELOG.md`.
7. Tag a release, for example `v0.1.0`.
8. Publish GitHub release notes.

## Issue Triage

- Label bugs with `bug`.
- Label documentation gaps with `documentation`.
- Label approachable starter work with `good first issue`.
- Route security-sensitive reports to private vulnerability reporting.

## OSS Application Notes

CodexBro is best described as an early-stage reference implementation for local agent execution infrastructure. Avoid overstating usage metrics. Prefer concrete evidence: CI status, releases, docs, issue triage, and reproducible setup.


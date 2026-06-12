# Screenshots

The repository includes non-sensitive UI verification screenshots:

- `assets/verification/ui-smoke-dashboard.png`
- `assets/verification/ui-smoke-mobile.png`
- `assets/concepts/codexbro-dashboard-concept.png`

## Included Images

| Image | Purpose | What reviewers should check |
| --- | --- | --- |
| `assets/verification/ui-smoke-dashboard.png` | Dashboard smoke screenshot for the desktop-width task workspace. | Task history, conversation feedback, execution overview, and worker/task controls are visible without exposing private content. |
| `assets/verification/ui-smoke-mobile.png` | Mobile smoke screenshot for the compact task surface at a 390px viewport. | Navigation, primary controls, and task content remain usable in the narrow layout. |
| `assets/concepts/codexbro-dashboard-concept.png` | Concept reference for visual direction. | Treat this as design inspiration, not as proof of current product behavior. |

### Dashboard Smoke

Use `assets/verification/ui-smoke-dashboard.png` when reviewing the main desktop dashboard state. It should demonstrate the high-level workspace layout, the task list/history area, conversation feedback, execution status, and available worker controls.

### Mobile Smoke

Use `assets/verification/ui-smoke-mobile.png` when reviewing responsive behavior. It should demonstrate that the mobile navigation, task surface, and primary actions remain readable and reachable at a narrow viewport.

### Concept Reference

`assets/concepts/codexbro-dashboard-concept.png` is a visual concept reference, not a live product screenshot.

## Privacy Checklist

Before adding or replacing screenshots:

- Use local demo data only.
- Do not include real accounts, customer data, private repositories, tokens, API keys, cookies, or session identifiers.
- Avoid showing private file paths, terminal history, authenticated browser tabs, or notification content.
- Crop or retake the screenshot if any personal information appears in the browser chrome, desktop, or app content.
- Prefer deterministic smoke-test screenshots over manually captured production data.

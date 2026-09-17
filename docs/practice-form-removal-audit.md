# Practice Form Removal Audit

Date: 2026-06-18

## Summary

The project direction has moved from a local dummy ticket form toward a generic, site-profile based ticket operation verification tool. The local practice form was useful as an early sandbox, but it created a second maintenance path beside `site_profile_runner.js` and the auto-selection settings flow.

Local practice form support was removed in this PR. The generic runner remains available, but generic `run:site-profile` usage now requires an explicit profile path instead of falling back to a local practice profile.

## Removed Items

| Item | Mark | Removal Risk | Result |
| --- | --- | --- | --- |
| `practice_ticket_form.html` | remove | Medium | Removed. The local dummy form route was also removed from `timing_assistant_server.js`. |
| `practice_config.json` | remove | Low | Removed with the legacy practice runner. |
| `playwright_practice.js` | remove | Medium | Removed. `package.json` no longer points `main` or `npm run check` at this file. |
| `site_profiles/practice_ticket_form.json` | remove | High | Removed after replacing the runner's practice-profile default. |
| `README_practice_ticket_automation.md` | remove | Medium | Removed as obsolete practice-form documentation. |

## Kept Items

| Item | Mark | Reason |
| --- | --- | --- |
| `site_profile_runner.js` | keep | Generic Playwright runner for explicitly provided site profiles. |
| `timing_assistant.html` / `timing_assistant.js` / `timing_assistant_server.js` | keep | Timing assistant and local settings server remain part of the generic tool. |
| `auto_selection_settings.html` / `auto_selection_settings.js` | keep | Auto-selection settings UI remains part of the generic workflow. |
| `auto_selection_settings.example.json` | keep | Safe example settings file. |
| `general_site_config.example.json` | keep | Generic configuration example. |
| `GENERAL_SITE_ARCHITECTURE.md` | keep | Updated to describe the generic site-profile direction. |
| `CHATGPT_MIGRATION_SCRIPT.md` | keep | Updated to avoid the removed practice profile example. |

## Package Changes

| Item | Mark | Result |
| --- | --- | --- |
| `main` | rename | Changed from `playwright_practice.js` to `site_profile_runner.js`. |
| `check` script | rename | Removed `node --check playwright_practice.js`. |
| `start` script | keep | Added as an alias for `node timing_assistant_server.js`. |
| `start:timing-assistant` | keep | Preserved. |
| `run:site-profile` | keep | Preserved. It now requires an explicit profile path for generic runs. |
| `run:auto-selection` | keep | Preserved. |
| `login:auto-selection` | keep | Preserved. |

## Runner Default Behavior

Before this removal, `site_profile_runner.js` silently defaulted to `site_profiles/practice_ticket_form.json` when no profile path was passed.

After this removal:

- `npm run run:site-profile` without a profile path prints usage guidance and exits with a non-zero status.
- `npm run run:site-profile -- path/to/site_profile.json` remains the generic site-profile execution path.
- `npm run run:auto-selection` and `npm run login:auto-selection` no longer require the removed practice profile as their base profile.
- No real-site profile was added as a silent default.

## Documentation Changes

| Document | Mark | Result |
| --- | --- | --- |
| `README.md` | keep | Rewritten around the generic site-profile workflow and safety boundary. |
| `GENERAL_SITE_ARCHITECTURE.md` | keep | Updated to remove local practice form as the main path. |
| `CHATGPT_MIGRATION_SCRIPT.md` | keep | Updated to use `path/to/site_profile.json` instead of the removed practice profile. |
| `README_practice_ticket_automation.md` | remove | Removed as obsolete. |

## Verification Plan

Run:

```bash
npm run check
git status --short
```

Confirm:

- `npm run check` does not reference removed files.
- `package.json` no longer points `main` to `playwright_practice.js`.
- `practice_ticket_form.html`, `practice_config.json`, `playwright_practice.js`, and `site_profiles/practice_ticket_form.json` are deleted from Git.
- `logs/`, `artifacts/`, `.playwright-user-data/`, `auto_selection_settings.json`, `.env`, screenshots, and traces are not staged.
- No real phone numbers, login/session data, cookies, tokens, SMS codes, or payment information are introduced.

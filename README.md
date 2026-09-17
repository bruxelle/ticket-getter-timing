# ticket-practice

Local Node.js / Playwright tools for generic site-profile based ticket operation verification.

This project helps open pages at a target time and verify assisted ticket-form operations up to the step immediately before purchase confirmation. Purchase confirmation must not be automated.

## Setup

Install dependencies:

```bash
npm install
```

Start the local timing assistant server:

```bash
npm run start:timing-assistant
```

Open the timing assistant:

```text
http://127.0.0.1:4173/
```

Open the auto-selection settings page:

```text
http://127.0.0.1:4173/auto-selection
```

## Site Profiles

The generic site-profile runner requires an explicit profile path:

```bash
npm run run:site-profile -- path/to/site_profile.json
```

Profiles define the allowed origin, target URL or target path, and verification steps for a site-specific flow. Do not use profiles to automate purchase confirmation.

## Local Settings

Create your local settings file from the safe example:

```bash
cp auto_selection_settings.example.json auto_selection_settings.json
```

Then edit `auto_selection_settings.json` locally. Do not commit the real settings file.

The local settings file may contain:

- target event URLs
- selected ticket type and favorite target
- purchaser name
- phone number
- local runtime preferences

## Login Preparation

The auto-selection runner uses a local Playwright profile so that manual login and phone verification can be completed once and reused locally.

```bash
npm run login:auto-selection
```

After completing login and phone verification in the opened browser, close the browser and run:

```bash
npm run run:auto-selection
```

You can temporarily override the target URL:

```bash
npm run run:auto-selection -- --target-url=https://example.com/event/placeholder
```

## Sensitive Local Files

The following paths may contain sensitive data and are ignored by Git:

- `auto_selection_settings.json`
- `.playwright-user-data/`
- `logs/`
- `artifacts/`
- `screenshots/`
- `.env`
- `*.zip`
- `*.trace.zip`

These paths may include login sessions, personal information, target URLs, screenshots, traces, and execution logs.

Do not commit sensitive data anywhere in the repository, even outside ignored paths. Git ignore rules only match paths and patterns; they cannot detect secrets inside arbitrary files. Review changes carefully for:

- real phone numbers
- real login or session data
- payment information
- personal names or account details
- real event URLs that should stay private

Before committing, always check:

```bash
git status --short
```

Confirm that local settings, Playwright user data, logs, screenshots, traces, and `node_modules/` are not staged or tracked.

If any sensitive files were already tracked in Git, do not delete them from disk. Remove them from Git tracking only:

```bash
git rm --cached <path>
```

## Development Workflow

Use Pull Requests for repository changes:

1. Create a branch from `main`.
2. Make changes on the branch.
3. Run local checks:

```bash
npm run check
```

4. Check the working tree before committing:

```bash
git status --short
```

5. Open a Pull Request.
6. Confirm GitHub Actions CI passes before merging.

Do not commit runtime artifacts or sensitive local data, including `logs/`, `artifacts/`, `.playwright-user-data/`, `auto_selection_settings.json`, `.env`, screenshots, Playwright traces, real phone numbers, real login/session data, or payment information.

Purchase confirmation automation is out of scope for this project and should not be added.

## Verification

Run syntax checks before opening a pull request:

```bash
npm run check
```

## Safety Boundary

This project should only assist up to the purchase-confirmation step. Do not add automation that clicks a final purchase, payment, or order-confirmation button.

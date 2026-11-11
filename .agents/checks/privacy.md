# Check: privacy and secrets

This repository is public, and the npm package ships `dist/`, `scripts/` and `CHANGELOG.md`.

## Report

- A secret, API key, token or password, even an expired one.
- Real user data in fixtures, tests or docs: real names, emails, user or workspace IDs, message content or URLs copied from an account.
- Personal identifiers in docs and examples: real emails, usernames, home-directory paths, local repository names. Use placeholders (`alice@example.com`, `~/code`).
- Internal details: private hostnames, internal URLs, Todoist-internal tools or documents. The staging host already used in tests as a stand-in base URL is fine.
- A new file under `scripts/` or in package.json `files` that should not be published.
- Untracked files the change doesn't need (`.env`, logs, `.tmp/`).

## Fine

- Made-up fixtures and cli-core's fictional test accounts (Alan Grant, Ellie Sattler).
- Public URLs: the Comms app and API, GitHub.

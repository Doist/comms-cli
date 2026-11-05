# Check: security

The CLI holds the user's Comms token and reads their messages. Apply to changes in `src/` and `scripts/`.

## Report

- A token, `Authorization` header or `COMMS_API_TOKEN` value written to output, logs, errors, `--json` or progress events.
- A secret fetched that the command does not display. An opt-in reveal flag must gate the API call, not just the printing.
- Token storage that bypasses the keyring-backed store in `src/lib/auth.ts`, or a token written to the config file outside the documented offline fallback (`src/lib/user-records.ts`).
- A mutating SDK method added to `KNOWN_SAFE_API_METHODS` in `src/lib/permissions.ts`, which lets it run under a read-only token.
- Private channel content shown without `--include-private-channels` (or `COMMS_INCLUDE_PRIVATE_CHANNELS`): new output that skips the filtering in `src/lib/public-channels.ts`.
- A shell command built from user or API input as a string, instead of `spawn`/`execFile` with an argument list (`openEditor()` in `src/lib/input.ts` runs `$EDITOR`); a URL from API data opened in the browser without checking it is an http(s) URL.
- OAuth changes (`src/lib/auth-provider.ts`, `src/lib/scopes.ts`, `oauth/client-metadata.json`) that widen the scopes a plain `tdc auth login` asks for.
- `src/postinstall.ts` doing more than refreshing installed skills: it runs on every install.

## Fine

- Logging command names, durations, counts and error codes.
- Test fixtures with fake tokens.

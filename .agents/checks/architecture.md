# Check: architecture

Rules lint and types can't express. Most are written in `AGENTS.md` and `CODEBASE.md`; report where a change works around one.

## Report

- A user-facing error thrown as a bare `Error`, or printed with `console.error()` and an exit code, instead of `CliError(code, message, hints?)` from `src/lib/errors.ts`; a new code missing from the `ErrorCode` type; `process.exit()` in a command handler.
- A new SDK call without an entry in `API_SPINNER_MESSAGES` (`src/lib/api.ts`), or a read-only one missing from `KNOWN_SAFE_API_METHODS` in `src/lib/permissions.ts` (a read-only token would block it).
- A mutating command without `--json` where it has scripting value, or `json`/`full` options added by hand instead of extending `MutationOptions` in `src/lib/options.ts`.
- Reference parsing (ids, URLs, fuzzy names) written again instead of using `src/lib/refs.ts`.
- A positional `[workspace-ref]` without the `--workspace` alias, or one that accepts both without an error.
- A new top-level command not wired into the lazy registry in `src/index.ts`.
- A barrel file, or a helper that duplicates one in `src/lib/` or `@doist/cli-core`. Where cli-core has a convention, the CLI follows it.

## Fine

- An exception documented next to the code, with the reason.
- A new broadly reusable helper in `src/lib/`, added to the `CODEBASE.md` catalog.

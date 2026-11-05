# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Definition of done

- **Done means proven:** a test that failed before the change and passes after, or the command's real output (`node dist/index.js <command>`, on a test workspace). For a refactor: tests that pin the behaviour, passing before and after. Reading code or a passing compile is not proof.
- **Run `npm run verify` before calling a change done.** It runs every check CI runs, in about fifteen seconds, and records the pass. It prints what it cannot see, and says when only docs changed and there is nothing to check.
- **Never weaken a check to pass it.** Don't skip, delete or loosen tests, edit lint, type or test config to get green, or use `--no-verify`. If a check looks wrong, say so and stop.
- **Report honestly:** what ran, what it showed, and what you did not verify.

## Skills

Use the matching skill without being asked. They live in `.agents/skills/` (Claude Code reads them through `.claude/skills/`).

- `verify`: before saying a change is done, fixed or ready.
- `fix-bug`: something is broken or wrong.
- `build-feature`: a new command, flag or behaviour.
- `add-command`: the checklist of files to touch for a new command or subcommand.
- `refactor`: changing structure without changing behaviour. Other tasks send restructuring here, as a separate change.
- `write-tests`: writing or changing tests; `.agents/skills/write-tests/references/test-rules.md` is the quality bar.
- `learn`: after a correction, to turn it into a check.
- `review-changes`: when the owner says a change is ready for a PR, or asks for a review.

## Review checks

Reviewers, Doistbot included, apply these to every change:

- [Tests](.agents/checks/tests.md): not weakened, new behaviour tested.
- [Architecture](.agents/checks/architecture.md): rules lint can't express.
- [Security](.agents/checks/security.md): the token, read-only mode, private channels, shelling out.
- [Privacy and secrets](.agents/checks/privacy.md): this repository is public.
- [Command surface](.agents/checks/command-surface.md): what people, scripts and agents see.
- [Evidence](.agents/checks/evidence.md): claims backed by what ran.

## Commands

```bash
npm run build          # Compile TypeScript to dist/ (uses tsconfig.build.json, excludes tests)
npm run dev            # Watch mode compilation (uses tsconfig.build.json, excludes tests)
npm test               # Run all tests (vitest)
npm run test:watch     # Run tests in watch mode
npm run type-check     # Type check src + tests (tsconfig.json) and the agent tooling (.agents/scripts)
npm run lint           # Fix lint issues (oxlint) + format (oxfmt)
npm run lint:check     # Check lint + formatting (for CI)
npm run verify         # Every check CI runs (lint, format, types, tests, build, skill sync)
```

The project uses two tsconfig files: `tsconfig.json` includes test files for type-checking, while `tsconfig.build.json` extends it and excludes colocated `*.test.ts` and `*.spec.ts` files (plus `src/__mocks__`) so test-only code is not compiled into `dist/`.

Tests are colocated next to the module they cover (for example `src/commands/thread/thread.test.ts` or `src/lib/refs.test.ts`). Shared Vitest manual mocks for npm packages live in `src/__mocks__/` (e.g. `chalk.ts`).

`vitest.config.ts` lists `@doist/cli-core` in `server.deps.inline` so `vi.mock('@doist/cli-core', …)` and `vi.doMock('node:fs/promises', …)` reach cli-core's compiled imports. Without it, vitest treats the package as external and Node's native resolver bypasses the mock substitution, breaking the `auth` / `config` / spinner suites.

Run a single test file:

```bash
npx vitest run src/lib/refs.test.ts
```

Run the CLI locally:

```bash
node dist/index.js <command>
# or after build:
./dist/index.js <command>
```

## Architecture

This is a TypeScript CLI (`tdc`) for Comms messaging, built with Commander.js.

**Entry point**: `src/index.ts` registers all commands with Commander.

**Commands** (`src/commands/`): Commands with multiple subcommands use a folder-based structure (`src/commands/<entity>/index.ts`) where the index file exports a `register*Command(program)` function and wires Commander subcommands to handler functions in sibling files. Single-command files remain as flat files (`src/commands/<entity>.ts`). Each subcommand handler file exports one async action function and imports from `../../lib/`. An optional `src/commands/<entity>/helpers.ts` holds shared constants/utilities used by multiple subcommands. Commands support `--json`, `--ndjson`, and `--full` flags for machine-readable output.

**Lib** (`src/lib/`):

- `api.ts` - Singleton CommsApi client from `@doist/comms-sdk`, workspace/user caching
- `refs.ts` - Reference parsing: accepts IDs (`id:<id>` or bare IDs when unambiguous), Comms URLs, or fuzzy names for workspaces/users/channels/groups
- `output.ts` - JSON/NDJSON formatting with essential field filtering per entity type
- `config.ts` - Persists config to `~/.config/comms-cli/config.json`
- `auth.ts` - Token loading/saving/clearing (env var or config file)
- `markdown.ts` - Terminal markdown rendering via `marked` + `marked-terminal`
- `completion.ts` - Commander tree-walker + completion helpers for shell tab completion

**Reference system**: The CLI accepts flexible references throughout - `id:` prefixed IDs, bare IDs when unambiguous, full Comms URLs (parsed via `parseCommsUrl`), or fuzzy name matching for workspaces/users/channels/groups. Workspace and user IDs are numeric; most Comms entity IDs (threads, channels, comments, messages, conversations, groups) are opaque strings.

## Key Patterns

- **Implicit view subcommand**: `tdc thread <ref>` defaults to `tdc thread view <ref>` via Commander's `{ isDefault: true }`. Same for `conversation` and `msg`. Edge case: if a ref matches a subcommand name (e.g., "reply"), the subcommand wins — user must use `tdc thread view reply`
- **Named flag aliases**: Where commands accept positional `[workspace-ref]`, the `--workspace` flag is also accepted. Error if both positional and flag are provided
- **JSON output on mutating commands**: Mutating commands (create, update, delete, archive) should support `--json` output where it provides scripting value. Commands that return an object from the API (create/update) should also support `--full`. Commands where the API returns void should output a minimal status object (e.g. `{ id, deleted: true }` or `{ id, isArchived: true }`). Extend `MutationOptions` in `src/lib/options.ts` (which already includes `json` and `full`) rather than adding these fields ad hoc. Use `formatJson()` from `src/lib/output.ts` for the output. See `src/commands/status/set.ts` as the reference implementation.
- **Spinner messages**: When adding new SDK method calls, add a corresponding entry in the `API_SPINNER_MESSAGES` map in `src/lib/api.ts`. Every user-facing API call should have a spinner message so the CLI shows progress feedback.

## Error Handling

- **Always use `CliError` from `src/lib/errors.ts`** instead of bare `throw new Error(...)`, `console.error() + process.exit(1)`, or `console.error() + process.exitCode = 1`. This ensures structured error output in `--json` mode and consistent formatting in text mode. The global error handler in `src/index.ts` catches all errors, formats them appropriately, and sets the exit code. The same handler also matches `BaseCliError` (re-exported from `src/lib/errors.ts`) so errors thrown by `@doist/cli-core` helpers route through the same formatter.

```typescript
import { CliError } from '../../lib/errors.js'

throw new CliError('ERROR_CODE', 'User-facing message', ['Optional hint'])
```

- When adding a new error code, add it to the `ErrorCode` type in `src/lib/errors.ts` under the appropriate category.
- **Never use `process.exit(1)` in command handlers.** It terminates immediately without running `finally` blocks, which leaves the early loading spinner stuck in the terminal. Use `throw new CliError(...)` instead — this lets the process exit cleanly after spinner cleanup.

## Git hooks and agent tooling

- Lefthook refuses commits and pushes to `main`, runs oxlint, oxfmt and the type check on pre-commit, and the tests on pre-push. Work on a branch.
- Agent tooling lives in `.agents/scripts/`, never in `scripts/` (which ships in the npm package).
- How it all fits together: [`docs/agents.md`](docs/agents.md).

## Skill Content (Agent Command Reference)

The file `src/lib/skills/content.ts` exports `SKILL_CONTENT` — a comprehensive command reference that gets installed into AI agent skill directories via `tdc skill install`. This is the source of truth that agents use to understand available CLI commands.

**Whenever commands, subcommands, flags, or options are added, updated, or removed in `src/commands/`, the `SKILL_CONTENT` in `src/lib/skills/content.ts` must be updated to match.** This includes:

- Adding new commands or subcommands with usage examples
- Adding, removing, or renaming flags and options
- Updating the Quick Reference section when new top-level commands are introduced
- Keeping examples accurate and consistent with actual CLI behavior

After updating `SKILL_CONTENT`:

1. Run `npm run build && npm run sync:skill` to regenerate `skills/comms-cli/SKILL.md` (the standalone skill file used by `npx skills add`)
2. Run `tdc skill update claude-code` (and any other installed agents) to propagate changes to installed skill files

A CI check (`npm run check:skill-sync`) runs on pull requests and will fail if `skills/comms-cli/SKILL.md` is out of sync with `content.ts`.

## Changing the CLI icon

Follow [docs/icon.md](docs/icon.md). Never rename or delete files in `icons/`: OAuth clients registered by released versions keep the `logo_uri` they sent, so every path a release has used must keep serving the icon.

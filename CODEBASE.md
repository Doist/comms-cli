# CODEBASE.md — Repo Map

> **Purpose:** a ~2000-token orientation file so Claude (and humans) can navigate
> this repo without exploring. Describes _what is where_; `AGENTS.md` describes
> _how to change things_. Update when structure shifts, not on every new file.

## What this project is

`@doist/comms-cli` is a **TypeScript CLI** for Comms messaging. Binary name:
`tdc`. It wraps `@doist/comms-sdk` and publishes a single executable
(`dist/index.js`).

ESM-only · Node `^20.19 || >=22.12` · Commander 14 · vitest · oxlint + oxfmt (no
eslint/prettier) · semantic-release on merge to `main`. Shared building blocks
(config I/O, output formatters, spinner, OAuth/keyring auth, command attachers)
come from `@doist/cli-core`.

## Top-level layout

```
/
├─ src/                   # All source. See tree below.
├─ scripts/               # sync-skill.js, check-skill-sync.js, postinstall.js
├─ dist/                  # Build output (tsc). Never edit.
├─ skills/comms-cli/      # Generated SKILL.md (from src/lib/skills/content.ts)
├─ docs/                  # SPEC.md, comms-search.md (design notes)
├─ icons/                 # OAuth callback / skill logo assets
├─ .github/workflows/     # test, lint, release, check-skill-sync,
│                         # check-semantic-pull-request, issue-automation,
│                         # request-reviews, update-comms-sdk
├─ AGENTS.md              # Prescriptive rules (build cmds, JSON flag, skill-sync, errors)
├─ CODEBASE.md            # This file — descriptive map
├─ CLAUDE.md              # One-liner forward to AGENTS.md
├─ README.md / CONTRIBUTING.md
├─ tsconfig.json          # Includes src + tests (type-check, IDE)
├─ tsconfig.build.json    # Excludes *.test.ts/.spec.ts, __mocks__, __fixtures__
├─ vitest.config.ts       # { globals, root: 'src', inlines @doist/cli-core }
├─ .oxlintrc.json / .oxfmtrc.json
├─ lefthook.yml           # Pre-commit: type-check + oxlint + oxfmt; pre-push: tests
├─ renovate.json          # Dependency automation
└─ release.config.js      # semantic-release config
```

## `src/` tree

```
src/
├─ index.ts               # Entry: Commander setup, lazy command registry, --user strip, early spinner
├─ postinstall.ts         # Post-install notice logic (+ colocated test); scripts/postinstall.js calls it
├─ commands/              # One file per flat command, one folder per group (+ colocated *.test.ts)
│  ├─ inbox.ts, mentions.ts, search.ts, react.ts, view.ts,
│  │  user.ts, workspace.ts, doctor.ts, changelog.ts
│  ├─ thread/, conversation/, msg/, comment/, channel/, groups/,
│  │  account/, auth/, config/, skill/, completion/, update/
│  └─ <group>/index.ts    # registerXxxCommand(program) + sibling files per subcommand
├─ lib/                   # Shared utilities. See catalog — don't reimplement.
│  ├─ skills/             # content.ts (SKILL_CONTENT) + installer plumbing
│  └─ __fixtures__/       # accounts.ts — test fixtures (excluded from build)
└─ __mocks__/             # Manual vitest mocks for npm packages (chalk.ts)
```

## Architecture flow

1. `src/index.ts` sets `program.name('tdc')`, registers global flags
   (`--no-spinner`, `--progress-jsonl [path]`, `--include-private-channels`,
   `--accessible`, `--non-interactive`, `--interactive`), and builds a **lazy
   command registry** — `Record<name, [description, loader]>`.
2. Lightweight placeholder subcommands are registered so `--help` lists
   everything (with aliases) without importing any command module.
3. The global `--user <ref>` has **no** commander root option, so the cache is
   warmed via `getRequestedUserRef()` and then `stripUserFlag()` (from cli-core)
   rewrites `process.argv` before commander parses (see Auth below).
4. The invoked command name is resolved (aliases first); placeholders sharing
   that loader are spliced out and only its `register*Command(program)` runs.
   For human output, `preloadMarkdown()` runs in parallel with the import
   (skipped for `noMarkdownCommands` and under `--json`/`--ndjson`/`--raw`).
   `startEarlySpinner()` covers import latency.
5. `parseAsync().catch(...)` renders an uncaught `BaseCliError` via
   `formatError()` / `formatErrorJson()` (per `isJsonMode()`); anything else
   becomes an `INTERNAL_ERROR` envelope. `finally` always stops the spinner.

`completion-server` is a fast path: it loads only the completion module plus the
single command being completed (parsed from `COMP_LINE`).

## Command registration pattern

- **Flat command** (e.g. `inbox.ts`): exports `registerInboxCommand(program)`
  that calls `program.command('inbox')` and attaches an action.
- **Group command** (e.g. `thread/`): `index.ts` exports
  `registerThreadCommand(program)`, creates `const thread = program.command('thread')`,
  then wires `thread.command('<sub>')` to sibling files (`thread/view.ts`,
  `thread/reply.ts`, …). Shared logic lives in `<group>/helpers.ts`.
- **Implicit `view` subcommand**: `thread`, `conversation`, `msg` register
  `.command('view <ref>', { isDefault: true })` so `tdc thread <ref>` →
  `tdc thread view <ref>`. A ref colliding with a subcommand name loses to the
  subcommand.
- **Aliases**: `channels→channel`, `convo→conversation`, `message→msg`.

## Commands catalog (grouped domains)

Subcommand enumeration lives in `src/lib/skills/content.ts` (`SKILL_CONTENT`) —
don't duplicate it here.

- **Threads** (`thread/`) — view, create, reply, rename, update, mutate (move),
  mute, delete
- **Channels** (`channel/`) — list, threads, create, update
- **Conversations / DMs** (`conversation/`) — view, with, reply, unread, mute,
  unmute, done; **messages** (`msg/`) — view, update, delete
- **Comments** (`comment/`) — view, update, delete
- **Groups** (`groups/`) — list, view, create, rename, delete, members
- **Top-level reads** — `inbox`, `mentions`, `search`, `view` (URL router)
- **Reactions** — `react` / `unreact` (thread, comment, message)
- **Identity & infra** — `user`/`users`, `workspace`/`workspaces`,
  `auth` (login/logout/token/status), `account` (list/current/use/remove),
  `config`, `skill`, `completion`, `update`, `changelog`, `doctor`

## `src/lib/` catalog — don't reimplement

- **`api.ts`** — `getCommsClient()` / `createWrappedCommsClient()` singleton
  `CommsApi` (workspace + user caching, `API_SPINNER_MESSAGES`), and domain
  wrappers (`fetchWorkspaces`, `getSessionUser`, `getWorkspaceUsers`,
  `buildUserNameMap`, group CRUD + member mutators). Commands call
  `client.<domain>.<method>()` directly off the wrapped client.
- **`refs.ts`** — flexible reference resolution: `isIdRef`, `extractId`,
  `looksLikeRawId`, `parseRef`, `parseCommsUrl` / `classifyCommsUrl` (routes
  `tdc view <url>`), and async resolvers `resolveWorkspaceRef`,
  `resolveChannelRef/Id`, `getDirectChannelId`, `resolveThreadId`,
  `resolveConversationId`, `resolveMessageId`, `resolveCommentId`,
  `resolveGroupRef`, `resolveUserRefs`, `parseNotifyIdRefs`.
- **`output.ts`** — `formatJson` / `formatNdjson` (+ paginated variants) with
  per-`EntityType` essential-field filtering, `formatError` / `formatErrorJson`,
  `printJson` / `printNdjson` / `printEmpty` / `printDryRun`, `colors`, `pluralize`.
- **`options.ts`** — `ViewOptions`, `PaginatedViewOptions`, `MutationOptions`
  (extend these rather than adding `json`/`full`/`ndjson` ad hoc).
- **`config.ts`** — `~/.config/comms-cli/config.json` I/O over cli-core
  (`getConfig`, `readConfigStrict`, `setConfig`, `updateConfig`),
  `validateConfigForDoctor`, `Config` / `StoredUser` / `UserSettings` shapes,
  `UPDATE_CHANNELS`.
- **`auth.ts`** — read-side token resolver: `getApiToken`, `probeApiToken`,
  `getAuthMetadata`, `NoTokenError`, `TOKEN_ENV_VAR` (`COMMS_API_TOKEN`).
- **`auth-provider.ts`** — `createCommsAuthProvider()` (cli-core **DCR** provider
  with a Comms `validate` hook), `createCommsTokenStore()` (cli-core keyring
  store wrapped with env-token + manual-token fallbacks), `matchCommsAccount`,
  `getScopes`, `MANUAL_TOKEN_ACCOUNT` / `isManualTokenAccount`,
  `findAccountInStore`, `getActiveTokenSource`. **No legacy/v1 migration** — this
  CLI shipped multi-account from the start.
- **`comms-account.ts`** — `makeCommsAccount` / `toCommsAccount` mappers.
- **`user-records.ts`** — `UserRecordStore<CommsAccount>` adapter over
  `config.users[]`, `getDefaultUserRecord`.
- **`auth-constants.ts`** — keyring service/slot names; **`auth-pages.ts`** —
  branded OAuth callback HTML.
- **`global-args.ts`** — `isJsonMode`, `isNdjsonMode`, `getRequestedUserRef`,
  `isNonInteractive`, `includePrivateChannels`, `isAccessible`,
  `shouldDisableSpinner`, progress-jsonl getters (layered on cli-core's parser).
- **`permissions.ts`** — `ensureWriteAllowed`, `isMutatingMethod` (read-only-scope guard).
- **`markdown.ts`** — `preloadMarkdown` / `renderMarkdown` (cli-core renderer).
- **`search-api.ts` / `search-helpers.ts`** — extended search params/response
  (`extendedSearch`) + shared `--search`/options wiring (`addSharedSearchOptions`,
  `runSearch`, `printSearchResults`). See `docs/comms-search.md`.
- **`threads.ts`** — `fetchUnreadThreadIds`; **`public-channels.ts`** —
  public-channel id cache + `assertChannelIsPublic`.
- **`spinner.ts`** — re-exports `LoadingSpinner`, `withSpinner`,
  `startEarlySpinner`, `stopEarlySpinner` from cli-core.
- **`completion.ts`** — Commander tree-walker + `parseCompLine`, `getCompletions`,
  `withCaseInsensitiveChoices`, `withUnvalidatedChoices`.
- **`progress.ts`** — `ProgressTracker` JSONL event writer (`--progress-jsonl`).
- **`dates.ts`** — `formatRelativeDate`, `parseDate`; **`input.ts`** —
  `readStdin`, `openEditor`; **`validation.ts`** — `validateNonEmptyName`;
  **`update.ts`** — `fetchLatestVersion`, `getConfiguredUpdateChannel`;
  **`errors.ts`** — `CliError(code, message, hints?)`, `ErrorCode` union,
  `isInsufficientScope`.
- **`skills/content.ts`** — `SKILL_CONTENT` (agent command reference, source of truth).

## Canonical examples

- **Read:** `src/commands/inbox.ts` — `getCommsClient()`, parallel fetches
  (`getInbox` + `fetchUnreadThreadIds`), public-channel handling, then
  `formatJson` / `formatNdjson` / `printEmpty`.
- **Mutation with `--json`:** `src/commands/channel/create.ts` — the reference
  impl for `MutationOptions`, `ensureWriteAllowed`, `printDryRun`, and
  `formatJson(entity, 'channel', options.full)`.
- **Grouped command:** `src/commands/thread/index.ts` + siblings — implicit
  `view` default, one file per subcommand, `thread/helpers.ts` for shared logic.

## Ref resolution

All in `src/lib/refs.ts`. A ref is one of: a bare numeric id (`123`), an
`id:`-prefixed id, a full Comms URL (`parseCommsUrl` → `classifyCommsUrl` routes
`tdc view <url>`), or a fuzzy name (workspaces/users/channels/groups). Async
resolvers return the resolved id or entity and throw `CliError` (e.g.
`AMBIGUOUS_*`, `*_NOT_FOUND`) on miss. `looksLikeRawId()` decides when a string
is tried as an id vs a name.

## Auth & token storage

`@doist/cli-core/auth` owns the keyring, multi-user `TokenStore`, OAuth flow,
and the `login` / `logout` / `status` / `token view` and `account
list/use/current/remove` attachers. comms supplies (a) a
`UserRecordStore<CommsAccount>` adapter (`user-records.ts`) over its config file
and (b) a Comms **DCR** provider `validate` (`auth-provider.ts`) that probes
`getSessionUser` and records auth mode/scope (derived from `handshake.readOnly`).

Read path (`auth.ts`): env `COMMS_API_TOKEN` first, then the keyring store
(`createCommsTokenStore` — wrapped so `active` / `activeBundle` / `activeAccount`
all honour the env token). A raw token saved via `tdc auth token` is stored as
`MANUAL_TOKEN_ACCOUNT` (empty id/label); `account list` hides it and `account
current` reports it as `source: token-only`. Writes/clears/lists route through
the store; commands never touch the config directly.

comms uses a **global** `--user <ref>` (accepted before the subcommand). Because
commander has no root `--user` option, `index.ts` strips it from argv
(`stripUserFlag`) after warming `getRequestedUserRef()`. `commands/auth/store-wrap.ts`
`withUserRefAware` substitutes that ref into the cli-core attachers (which only
see a per-command `--user`).

> Follow-up: once cli-core ships `getRequestedUserRef` on the auth attachers
> (Doist/cli-core#30), `store-wrap.ts`/`withUserRefAware` can be deleted.

## Testing

- **Runner:** vitest. `npm test` (one-shot), `npm run test:watch`. Single file:
  `npx vitest run src/lib/refs.test.ts`.
- **Location:** colocated `*.test.ts` next to the module under test.
- **Fixtures:** `src/lib/__fixtures__/accounts.ts` (`ACCOUNT_ALAN` /
  `ACCOUNT_ELLIE`) — don't hand-build account objects. Manual npm-package mocks
  in `src/__mocks__/` (`chalk.ts`).
- **`@doist/cli-core` inlining:** `vitest.config.ts` lists it in
  `server.deps.inline` so `vi.mock('@doist/cli-core', …)` /
  `vi.doMock('node:fs/promises', …)` reach its compiled imports — without it the
  auth/config/spinner suites break.

## Build & release

- **Build:** `tsc -p tsconfig.build.json` → `dist/` (then `chmod +x`). Two-tsconfig
  setup: `tsconfig.json` includes tests (type-check/IDE); `tsconfig.build.json`
  excludes `*.test.ts`/`.spec.ts` and `__mocks__`.
- **Type-check:** `npm run type-check`. **Lint/format:** `npm run lint`
  (oxlint --fix + oxfmt), `npm run lint:check` (CI). **No ESLint, no Prettier.**
- **Pre-commit:** lefthook (type-check + oxlint + oxfmt); **pre-push:** tests.
- **Release:** semantic-release on merge to `main`; Conventional Commits required
  (enforced by `check-semantic-pull-request.yml`). `update-comms-sdk.yml` keeps
  `@doist/comms-sdk` current.

## Skill content flow

`src/lib/skills/content.ts` (`SKILL_CONTENT`) is the **source of truth** for the
agent command reference. When commands/flags change:

1. Update `SKILL_CONTENT`.
2. `npm run build && npm run sync:skill` → writes `skills/comms-cli/SKILL.md`.
3. `tdc skill update claude-code` (and other installed agents) propagates it.
4. `check-skill-sync.yml` runs `npm run check:skill-sync` on PRs — fails if
   `SKILL.md` is out of sync with `content.ts`.

## Running the CLI directly (no install)

```bash
node dist/index.js --help
node dist/index.js inbox
node dist/index.js <cmd> ...
```

Uses the same token lookup as the installed `tdc` binary — `COMMS_API_TOKEN`,
config file, or a token in the OS credential manager via `tdc auth login`.

## Conventions (quick)

- Filenames: **kebab-case**; no barrels except per-group `index.ts` Commander wiring.
- User-facing errors: `throw new CliError(code, message, hints?)` from
  `src/lib/errors.ts` — never `process.exit(1)` (strands the spinner). The global
  handler also catches `BaseCliError` from cli-core helpers.
- Machine output: support `--json` / `--ndjson` (and `--full` on commands that
  return an object); check `isJsonMode()` / `isNdjsonMode()` before printing.
  Mutations extend `MutationOptions` and emit via `formatJson()`.
- Every user-facing SDK call gets an `API_SPINNER_MESSAGES` entry in `api.ts`.
- Status glyphs (`✓`/`✗`) allowed; otherwise no emojis.

## Start here if new

1. `src/index.ts` — entry + lazy command registry
2. `src/commands/inbox.ts` — canonical read
3. `src/commands/channel/create.ts` + `src/commands/thread/index.ts` — canonical mutation & group command
4. `src/lib/refs.ts` + `src/lib/output.ts` + `src/lib/api.ts` — what's already built
5. `src/lib/auth-provider.ts` — the cli-core auth wiring
6. `AGENTS.md` — rules you must follow

```

```

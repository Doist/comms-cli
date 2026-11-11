---
name: write-tests
description: Writes or changes tests in this repository to its quality bar, with the right helpers and layer. Use when adding, fixing or reviewing tests, when a change "needs a test", or when deciding whether a test may change.
---

# Write tests

## Where tests live

- Next to the code: `src/lib/refs.ts` → `src/lib/refs.test.ts`. A command group has one test file (`src/commands/thread/thread.test.ts`). Vitest, globals on.
- Command tests mock the Comms client, never the SDK: `getCommsClient` from `src/lib/api.ts` is swapped through `vi.hoisted` and `vi.mock('../../lib/api.js', …)`, keeping the rest of the module with `importOriginal`, and each test hands it a fake client built for that test. Build the program with `createTestProgram(registerXxxCommand)`, run `program.parseAsync(['node', 'tdc', ...])`, and capture output with `captureConsole()`. Read `src/commands/msg/msg.test.ts` for the shape.
- `src/index.test.ts` imports the entry point with its dependencies mocked, for argv handling and the early spinner.
- `vi.mock('chalk')` uses the manual mock in `src/__mocks__/chalk.ts`, which makes styling a passthrough so tests read plain text.
- Agent tooling tests live in `.agents/scripts/` and run copies of the tools in throwaway repos (`.agents/scripts/lib/test-repo.ts`).

## Helpers

From `src/lib/__fixtures__/accounts.ts`: `STORED_ALAN`, `STORED_ELLIE`, `ACCOUNT_ALAN`, `ACCOUNT_ELLIE`. From `@todoist/cli-core/testing`: `createTestProgram`, `captureConsole`, `captureStream`, `describeEmptyMachineOutput` (the shared check that `--json` and `--ndjson` print nothing extra for an empty result). Reset global flag state between tests with `resetGlobalArgs` from `src/lib/global-args.ts`.

## The quality bar

Read [references/test-rules.md](references/test-rules.md) before writing or reviewing a test. In short: a test counts only if it can fail. It asserts outcomes, takes expected values from outside the code under test, mocks only real boundaries, and you saw it fail once.

Done when each new test has failed once for the right reason, and then passes.

## When an existing test may change

- **The behaviour changed on purpose** (a feature or a fix): change the assertions that describe it, and say which in the report.
- **A refactor:** only how the test reaches the code (imports, names, call sites). Never its inputs or assertions, including expected output strings.
- **Never** to make a failing check pass without a behaviour change: no `.skip`, no deleted test, no looser matcher (`toEqual` → `toMatchObject`, exact arguments → `toHaveBeenCalled()`).

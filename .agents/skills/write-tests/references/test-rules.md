# Test rules

Calibrated on this repository's tests (about 1,200 in `src/`, November 2026). Each rule says what to flag and what is fine, because a rule that flags good tests teaches agents to damage them.

## 1. It can fail

You saw the test fail once: before the fix, or with the feature undone. A test that has never failed may be testing nothing.

## 2. It asserts outcomes

Assert what the user sees or what reaches the API: `toHaveBeenCalledWith(<exact args>)`, the exact output line, the parsed `--json` output. Flag an assertion that cannot tell right from wrong.

| Flag                                                                                                     | Fine                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toHaveBeenCalled()` as the only evidence the behaviour happened: nothing checks the arguments or output | `toHaveBeenCalled()` next to assertions on the arguments or output, when those carry the test's point (`src/commands/thread/thread.test.ts:1118`)                                         |
|                                                                                                          | `.not.toHaveBeenCalled()`: proves a call did **not** happen (about 190 in this repo, e.g. `msg delete` without `--yes` never reaches `deleteMessage`, `src/commands/msg/msg.test.ts:106`) |
| `toBeDefined()` / `toBeTruthy()` as the last word on a value                                             | The same as a guard right before reading the value's fields (`src/commands/auth/auth.test.ts:353`)                                                                                        |
| A test whose only assertion is that no error was thrown, when the behaviour is a result                  | `resolves.not.toThrow()` when accepting the input **is** the behaviour (a validator that must not reject)                                                                                 |

Judge a test by its point, the behaviour its name describes. A weak assertion beside the ones that carry that point is fine.

## 3. Expected values come from outside the code under test

Write the expected value out as literals (a lookup table or `it.each` rows are fine), or build it from fixtures. Flag an expectation that calls the code under test, or recomputes the answer the way the code does (the same formatter, string building or mapping function).

## 4. Mock only real boundaries

The real boundary here is the Comms API: `getCommsClient` from `src/lib/api.ts`, mocked with `vi.hoisted` and handed a fake client per test, the standard pattern in every command test. Also boundaries: I/O seams (`src/lib/config.ts`, `src/lib/auth.ts`, `src/lib/input.ts`, `src/lib/markdown.ts`, `node:fs/promises`, `chalk`) and the clock (`vi.useFakeTimers` with `vi.setSystemTime`). `vi.doMock` after `vi.resetModules()` is for modules with import-time side effects (`src/index.test.ts`) or a per-test config path (`src/commands/update/update.test.ts:13`).

| Flag                                                                                                            | Fine                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A **new** `vi.mock` of an internal module that holds logic (refs, output, search helpers), to make setup easier | The boundaries above. Existing mocks of `src/lib/refs.ts` that pin a resolved id (`src/commands/msg/msg.test.ts:13`): tolerated, not a pattern to copy |
| Mocking the function the test is about, or one that computes its expected value                                 |                                                                                                                                                        |

New tests should prefer feeding the fake client over mocking an internal module.

## 5. No skipped or focused tests

None exist today. `.only` fails in CI (`CI=true`, which `npm run verify` sets too). Don't add `.skip`, `.todo` or `xit` to get green. Fine: `it.skipIf` for a platform or permission the test cannot run under, with a comment saying so.

## 6. No fixed sleeps

There are none. Use fake timers (`src/commands/status/status.test.ts:43`) or wait on the event. Fine: a real wait a fake clock cannot drive, or a short one that proves something did **not** happen.

## 7. No snapshots

None exist: tests assert exact output strings or parse JSON output and compare it with `toEqual` (`src/commands/react.test.ts:69`). Keep it that way. A new snapshot records whatever the output is the first time it runs, so it proves nothing about what the output should be.

## 8. Reading source files is for contracts

Fine: a test that reads source or config to enforce a rule across the codebase (`src/lib/oauth-client-metadata.test.ts:11` checks the published OAuth metadata against the code; `.agents/scripts/lib/steps.test.ts` reads the workflows). Flag a test that reads a source file to check one function's behaviour; call the function instead.

## 9. No real user data

Fixtures use made-up names, emails and IDs (cli-core's fictional accounts, `example.com`). This repository is public: no real people, workspace IDs or internal hosts copied from an account.

# Check: command surface

What people and agents see: command and flag names, help text, human output, `--json`, `--ndjson` and `--full` shapes, error codes, and `SKILL_CONTENT`. Scripts and installed agent skills depend on every one.

## Report

- A renamed or removed command, flag or `--json` field, or a changed error code, without a breaking-change PR title (`feat!:`, `fix!:`).
- A command or flag change not reflected in `SKILL_CONTENT` (`src/lib/skills/content.ts`) and `skills/comms-cli/SKILL.md`, or an example there that no longer runs.
- List output that puts the id before the name, or separates them only by colour or dimming. Ids go after the name, so the line reads in `--accessible` mode.
- Meaning carried only by colour or symbols, with no `--accessible` alternative.
- Results printed to stderr or diagnostics to stdout; a spinner or prompt in `--json` or `--ndjson` mode.
- Several spinner labels for parallel fetches that build one view. They share one label.
- A flag named differently from the same flag elsewhere (`--workspace`, `--json`, `--full`, `--dry-run`, `--yes`), or a new verb where an existing one fits.
- An error message that does not name the problem, or hints without a working command.

## Fine

- New optional flags and new `--json` fields (additive) in a `feat:` PR.
- Help text wording fixes.

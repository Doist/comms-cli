<p align="center">
  <img src="icons/comms-cli.png" alt="Comms CLI" width="150" height="150" />
</p>

# Comms CLI

A command-line interface for Comms.

## Installation

> ```bash
> npm install -g @doist/comms-cli
> ```

### Agent Skills

Install skills for your coding agent:

```bash
cm skill install claude-code
cm skill install codex
cm skill install cursor
cm skill install gemini
cm skill install pi
cm skill install universal
```

Skills are installed to `~/<agent-dir>/skills/comms-cli/SKILL.md` (e.g. `~/.claude/` for claude-code, `~/.agents/` for universal, etc.). When updating the CLI, installed skills are updated automatically. The `universal` agent is compatible with Amp, OpenCode, and other agents that read from `~/.agents/`.

```bash
cm skill list
cm skill uninstall <agent>
```

## Uninstallation

First, remove any installed agent skills:

```bash
cm skill uninstall <agent>
```

Then uninstall the CLI:

```bash
npm uninstall -g @doist/comms-cli
```

## Local Setup

```bash
git clone https://github.com/Doist/comms-cli.git
cd comms-cli
npm install
npm run build
npm link
```

This makes the `cm` command available globally.

## Setup

```bash
cm auth login
```

This opens your browser to authenticate with Comms. Once approved, the token is stored in your OS credential manager:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service/libsecret

If secure storage is unavailable, the CLI warns and falls back to `~/.config/comms-cli/config.json`. Non-secret settings such as the current workspace remain in the config file.

### Alternative methods

**Manual token:**

```bash
cm auth token
```

The CLI prompts for the token without echoing it. Do **not** pass the token as a positional argument — it would be visible in `ps` / shell history.

**Environment variable:**

```bash
export COMMS_API_TOKEN="your-token"
```

`COMMS_API_TOKEN` always takes priority over the stored token.

### Auth commands

```bash
cm auth status   # check if authenticated
cm auth logout   # remove saved token
```

## Usage

```bash
cm inbox                           # inbox threads
cm inbox --unread                  # unread threads only
cm mentions                        # content mentioning you
cm mentions --since 2026-04-01 --all --json
cm thread view <ref>               # view thread with comments
cm thread view <ref> --comment 123 # view a specific comment
cm thread reply <ref>              # reply to a thread
cm thread rename <ref> "New title" # rename a thread
cm thread update <ref> "New body"  # edit a thread's body (first post)
cm conversation unread             # list unread conversations
cm conversation view <ref>         # view conversation messages
cm msg view <ref>                  # view a conversation message
cm search "keyword"                # search across workspace
cm search "keyword" --all          # fetch all result pages
cm react thread <ref> 👍          # add reaction
cm away                            # show away status
cm away set vacation 2026-03-20    # set away until date
cm away clear                      # clear away status
cm groups                          # list groups in a workspace
cm groups view <ref>               # show a group with members
cm groups create "Frontend"        # create a group
cm groups create "FE" --users alice@doist.com,bob@doist.com
cm groups rename <ref> "New name"  # rename a group
cm groups delete <ref> --yes       # delete a group
cm groups add-user <ref> alice@doist.com bob@doist.com
cm groups remove-user <ref> id:123,id:456
```

References accept IDs (`123` or `id:123`), Comms URLs, or fuzzy names (for workspaces/users).

Run `cm --help` or `cm <command> --help` for more options.

## Shell Completions

Tab completion is available for bash, zsh, and fish:

```bash
cm completion install        # prompts for shell
cm completion install bash   # or: zsh, fish
```

Restart your shell or source your config file to activate. To remove:

```bash
cm completion uninstall
```

## Machine-readable output

All list/view commands support `--json` and `--ndjson` flags for scripting:

```bash
cm inbox --json                    # JSON array
cm inbox --ndjson                  # newline-delimited JSON
cm inbox --json --full             # include all fields
```

## Development

```bash
npm install
npm run build       # compile
npm run dev         # watch mode
npm run type-check  # type check
npm run format      # format code
npm test            # run tests
```

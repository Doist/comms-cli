---
name: comms-cli
description: "Comms messaging CLI. View and respond to inbox threads, channel threads, direct messages, mentions, and group conversations; search, react, archive, mute, and manage workspaces. Use when the user mentions Comms, asks about their inbox, mentions, threads, DMs, channels, or wants to read or send Comms messages."
license: MIT
metadata:
  author: Doist
  version: "2.41.2"
---

# Comms CLI (cm)

Access Comms messaging via the `cm` CLI. Use when the user asks about their Comms workspaces, threads, messages, or wants to interact with Comms in any way.

## Setup

```bash
cm auth login                    # OAuth login (opens browser, read-write)
cm auth login --read-only        # OAuth login with read-only scope
cm auth login --callback-port <n># Override the local OAuth callback port (default 8766)
cm auth login --json             # Emit a JSON envelope for scripted / agent use
cm auth login --ndjson           # Emit an NDJSON envelope for scripted / agent use
cm auth token                    # Save API token manually (prompts securely; scope unknown, assumed write-capable)
cm auth status                   # Verify authentication + show mode
cm auth status --json            # Full status payload as JSON (--ndjson also supported)
cm auth status --user <ref>      # Target a specific stored account (id, id:<n>, or display name)
cm --user <ref> auth <status|logout|token view>  # Equivalent to passing --user after the subcommand; other commands accept the flag but ignore it
cm auth logout                   # Remove saved token and auth metadata
cm auth logout --json            # Emits `{"ok": true}` (--ndjson is silent)
cm auth logout --user <ref>      # Target a specific stored account; mismatched ref errors with ACCOUNT_NOT_FOUND
cm auth token view               # Print the saved token to stdout (pipe-safe; refuses if COMMS_API_TOKEN is set)
cm auth token view --user <ref>  # Print the saved token for a specific stored account
cm account [list|current|use <ref>|remove <ref>]  # Manage stored accounts; all support --json/--ndjson
                                 # current's payload is {id, label, authMode, authScope, source:"config"} | {source:"env"} | {source:"token-only"}
cm auth login                    # Re-running auth login with a different OAuth grant adds a NEW account; default stays pinned unless none was set
cm workspaces                    # List available workspaces
cm workspace use <ref>           # Set current workspace
cm completion install            # Install shell completions
cm config view                   # Show the current CLI configuration file (token masked)
cm config set <key> <value>      # Set a user preference (e.g. unarchive-new-threads true)
cm doctor                        # Diagnose CLI setup and environment issues
cm update                        # Update CLI to latest version
cm changelog                     # Show recent changelog entries
```

Stored auth uses the system credential manager when available. If secure storage is unavailable, `cm` warns and falls back to `~/.config/comms-cli/config.json`. `COMMS_API_TOKEN` always takes priority over the stored token, and legacy plaintext config tokens are migrated automatically when secure storage is available.

In read-only mode (`cm auth login --read-only`), commands that modify Comms data (reply, archive, react, delete, etc.) are blocked by the CLI. Externally provided tokens (`COMMS_API_TOKEN` or `cm auth token`) are treated as unknown scope and assumed write-capable.

## View by URL

```bash
cm view <url>                    # View any Comms entity by URL
```

Routes automatically based on URL structure:
- Message URL → `cm msg view`
- Conversation URL → `cm conversation view`
- Thread+comment URL → `cm thread view` (comment ID extracted from URL)
- Thread URL → `cm thread view`

All target command flags pass through (e.g. `--json`, `--raw`, `--full`).

## Inbox

```bash
cm inbox                         # Show inbox threads
cm inbox --unread                # Only unread threads
cm inbox --archive-filter all      # Show active + done threads
cm inbox --archive-filter archived # Show only done threads
cm inbox --channel <filter>      # Filter by channel name (fuzzy)
cm inbox --since <date>          # Filter by date (ISO format)
cm inbox --limit <n>             # Max items (default: 50)
```

## Threads

```bash
cm thread <thread-ref>           # View thread (shorthand for view)
cm thread view <thread-ref>      # View thread with comments
cm thread view <ref> --comment <id> # View a specific comment
cm thread view <url-with-/c/id>  # Comment ID extracted from URL
cm thread view <ref> --unread    # Show only unread comments
cm thread view <ref> --context 3 # Include 3 read comments before unread
cm thread view <ref> --limit 20  # Limit number of comments
cm thread view <ref> --since <date> # Comments newer than date
cm thread view <ref> --raw       # Show raw markdown
cm thread create <channel-ref> "Title" "content"    # Create a new thread
cm thread create <channel-ref> "Title" "content" --json       # Create and return as JSON
cm thread create <channel-ref> "Title" "content" --json --full # Include all thread fields
cm thread create <channel-ref> "Title" "content" --notify 123,456  # Notify specific users
cm thread create <channel-ref> "Title" "content" --unarchive  # Land thread in author's Inbox (overrides default Comms auto-archive)
cm thread create <channel-ref> "Title" "content" --no-unarchive  # Force archive even when userSettings.unarchiveNewThreads=true
cm thread create <channel-ref> "Title" "content" --dry-run  # Preview without posting
cm thread reply <ref> "content"  # Post a comment (notifies EVERYONE_IN_THREAD by default)
cm thread reply <ref> "content" --notify EVERYONE  # Notify all workspace members
cm thread reply <ref> "content" --notify 123,id:456   # Notify specific user IDs
cm thread reply <ref> "content" --json  # Post and return comment as JSON
cm thread reply <ref> "content" --json --full  # Include all comment fields
cm thread reply <ref> "content" --close       # Reply and close the thread
cm thread reply <ref> "content" --reopen      # Reply and reopen a closed thread
cm thread done <ref>             # Archive thread (mark done)
cm thread done <ref> --json      # Archive and return status as JSON
cm thread mute <ref>             # Mute thread for 60 minutes (default)
cm thread mute <ref> --minutes 480  # Mute for custom duration
cm thread mute <ref> --json      # Mute and return { id, mutedUntil } as JSON
cm thread mute <ref> --json --full  # Mute and return full thread as JSON
cm thread unmute <ref>           # Unmute a muted thread
cm thread unmute <ref> --json    # Unmute and return { id, mutedUntil } as JSON
cm thread delete <ref>             # Preview thread deletion (requires --yes to execute)
cm thread delete <ref> --yes       # Permanently delete a thread
cm thread delete <ref> --yes --json # Delete and return status as JSON
cm thread rename <ref> "New title"  # Rename a thread (change its title)
cm thread rename <ref> "New title" --json  # Rename and return { id, title } as JSON
cm thread rename <ref> "New title" --json --full  # Rename and return full thread as JSON
cm thread update <ref> "New body"   # Update a thread's body (the first post)
echo "New body" | cm thread update <ref>  # Update body from stdin
cm thread update <ref> "New body" --dry-run  # Preview without updating
cm thread update <ref> "New body" --json  # Update and return { id, content } as JSON
cm thread update <ref> "New body" --json --full  # Update and return full thread as JSON
```

Default `--notify` for reply is EVERYONE_IN_THREAD, which may notify more people than intended. Before posting, confirm with the user whether specific people should be notified instead (via `--notify <user-ids>`). Options: EVERYONE, EVERYONE_IN_THREAD, or comma-separated ID refs.

`--notify` automatically resolves IDs: group IDs are routed to the `groups` API field, user IDs to `recipients`. No special syntax needed.

## Thread Comments

```bash
cm comment <comment-ref>                       # View a comment (shorthand for view)
cm comment view <comment-ref>                  # View a single thread comment
cm comment view <comment-ref> --raw            # Show raw markdown
cm comment view <comment-ref> --json           # Output as JSON
cm comment view <comment-ref> --ndjson         # Output as newline-delimited JSON
cm comment view <comment-ref> --json --full    # Include all fields in JSON output
cm comment update <comment-ref> "new content"  # Update a thread comment
cm comment update <comment-ref> "content" --json  # Update and return updated comment as JSON
cm comment update <comment-ref> "content" --json --full  # Include all comment fields
cm comment delete <comment-ref>                # Delete a thread comment
cm comment delete <comment-ref> --json         # Delete and return status as JSON
```

## Conversations (DMs/Groups)

```bash
cm conversation unread                    # List unread conversations
cm conversation <conversation-ref>        # View conversation (shorthand for view)
cm conversation view <conversation-ref>   # View conversation messages
cm conversation with <user-ref>           # Find your 1:1 DM with a user
cm conversation with <user-ref> --snippet # Include the latest message preview
cm conversation with <user-ref> --include-groups # List any conversations with that user
cm conversation reply <ref> "content"     # Send a message
cm conversation reply <ref> "content" --json  # Send and return message as JSON
cm conversation reply <ref> "content" --json --full  # Include all message fields
cm conversation done <ref>                # Archive conversation
cm conversation done <ref> --json         # Archive and return status as JSON
cm conversation mute <ref>               # Mute conversation for 60 minutes (default)
cm conversation mute <ref> --minutes 480 # Mute for custom duration
cm conversation mute <ref> --json        # Mute and return { id, mutedUntil } as JSON
cm conversation mute <ref> --json --full # Mute and return full conversation as JSON
cm conversation unmute <ref>             # Unmute a muted conversation
cm conversation unmute <ref> --json      # Unmute and return { id, mutedUntil } as JSON
```

Alias: `cm convo` works the same as `cm conversation`.

## Conversation Messages

```bash
cm msg <message-ref>             # View a message (shorthand for view)
cm msg view <message-ref>        # View a single conversation message
cm msg update <ref> "content"    # Edit a conversation message
cm msg update <ref> "content" --json  # Edit and return updated message as JSON
cm msg update <ref> "content" --json --full  # Include all message fields
cm msg delete <ref>              # Delete a conversation message
cm msg delete <ref> --json       # Delete and return status as JSON
```

Alias: `cm message` works the same as `cm msg`.

## Search

```bash
cm mentions                      # Show content mentioning current user
cm mentions --since 2026-04-01 --all # Fetch every mention since a date
cm mentions --type threads --json # Limit mentions to threads
cm search "query"                # Search content
cm search "query" --type threads # Filter: threads, messages, or all
cm search "query" --author <ref> # Filter by author
cm search "query" --to <ref>     # Messages sent to user
cm search "query" --title-only   # Search thread titles only
cm search "query" --mention-me   # Results mentioning current user
cm search "query" --conversation <refs> # Limit to conversations (comma-separated refs)
cm search "query" --since <date> # Content from date
cm search "query" --until <date> # Content until date
cm search "query" --channel <refs> # Filter by channel refs (comma-separated)
cm search "query" --limit <n>    # Max results (default: 50)
cm search "query" --cursor <cur> # Pagination cursor
cm search "query" --all          # Fetch all result pages
```

## Users, Channels & Groups

```bash
cm user                          # Show current user info
cm user --json                   # JSON output
cm user --json --full            # Include all fields in JSON output
cm users                         # List workspace users
cm users --search <text>         # Filter by name/email
cm channels                      # List active joined workspace channels (alias of: cm channel list)
cm channels --state all          # Include archived joined channels too
cm channels --scope discoverable # Active public channels you can see but have not joined
cm channels --scope public --state all --json # All visible public channels, with joined status
cm channel threads <channel-ref>  # List threads in a channel (fuzzy name, id:, numeric ID, or URL)
cm channel threads "general" --unread       # Only unread threads
cm channel threads <ref> --archive-filter all  # Include archived threads (active|archived|all)
cm channel threads <ref> --since 2026-01-01 # Filter by last-updated date (ISO)
cm channel threads <ref> --limit 20         # Max threads per page (default: 50)
cm channel threads <ref> --limit 20 --cursor <cursor-from-prev> # Paginate
cm channel threads <ref> --json  # { results, nextCursor } with isUnread + url
cm groups                        # List workspace groups
cm groups --search "frontend"    # Filter groups by name (case-insensitive)
cm groups --json                 # JSON output
cm groups --json --full          # Include all fields in JSON output
cm groups view <group-ref>       # Show group with member details
cm groups view <ref> --json      # JSON output with id, name, workspaceId, members
cm groups view <ref> --json --full  # Include all fields in JSON output
cm groups create "Name"          # Create a new group
cm groups create "Name" --users alice@doist.com,bob@doist.com  # Create with members
cm groups create "Name" --json   # Output created group as JSON
cm groups rename <group-ref> "New name"  # Rename a group
cm groups rename <ref> "Name" --json     # Output renamed group as JSON
cm groups delete <group-ref> --yes       # Delete a group (requires --yes)
cm groups delete <ref> --dry-run         # Preview deletion
cm groups add-user <group-ref> user1 user2   # Add users to a group
cm groups add-user <ref> a@d.com,b@d.com     # Comma-separated refs
cm groups add-user <ref> id:123 --json       # Output result as JSON
cm groups remove-user <group-ref> user1 user2  # Remove users from a group
cm groups remove-user <ref> id:123,id:456      # Comma-separated ID refs
```

If a channel is not found in `cm channels`, widen with broader listings such as `cm channels --scope public`, then `cm channels --scope public --state all`. Check `cm channels --help` for other available filters.

`cm channel threads` returns every thread in the channel; pagination filters (`--limit`, `--cursor`, `--since`, `--until`, `--unread`) are applied client-side after fetch. `--archive-filter` is applied server-side. Results are sorted newest-first by last activity. In `--json` / `--ndjson`, the response includes a `nextCursor` string (opaque) you can pass via `--cursor` to fetch the next page; NDJSON emits the cursor as a final `{ "_meta": true, "nextCursor": "..." }` line.

## Away Status

```bash
cm away                          # Show current away status
cm away set <type> [until]       # Set away (type: vacation, parental, sickleave, other)
cm away set vacation 2026-03-20  # Away until March 20
cm away set vacation 2026-03-20 --from 2026-03-15  # Custom start date
cm away clear                    # Clear away status
```

## Reactions

```bash
cm react thread <ref> 👍         # Add reaction to thread
cm react comment <ref> +1        # Add reaction (shortcode)
cm react message <ref> heart     # Add reaction to DM message
cm react thread <ref> 👍 --json  # Output result as JSON
cm unreact thread <ref> 👍       # Remove reaction
cm unreact thread <ref> 👍 --json # Output result as JSON
```

Supported shortcodes: +1, -1, heart, tada, smile, laughing, thinking, fire, check, x, eyes, pray, clap, rocket, wave

## Shell Completions

```bash
cm completion install            # Install tab completions (prompts for shell)
cm completion install bash       # Install for specific shell
cm completion install zsh
cm completion install fish
cm completion uninstall          # Remove completions
```

### Diagnostics

```bash
cm doctor                        # Run local + network diagnostics
cm doctor --offline              # Skip Comms and npm network checks
cm doctor --json                 # JSON output with per-check results
```

### Configuration

```bash
cm config view                   # Pretty-printed config, token masked, labels actual token source
cm config view --json            # Raw JSON, token masked
cm config view --show-token      # Include the full token
cm config set unarchive-new-threads true   # Persist: always unarchive new threads so they land in your Inbox
cm config set unarchive-new-threads false  # Persist: keep Comms's default (thread auto-archived for author)
```

User preferences are stored under `userSettings` in the config file. Currently supported keys: `unarchive-new-threads`. The flag on `cm thread create` (`--unarchive` / `--no-unarchive`) overrides this default per-invocation.

### Update

```bash
cm update                        # Update CLI to latest version
cm update --check                # Check for updates without installing, show channel
cm update --check --json         # Same, JSON envelope
cm update --check --ndjson       # Same, newline-delimited JSON envelope
cm update --channel              # Show current update channel
cm update switch --stable        # Switch to stable release channel
cm update switch --pre-release   # Switch to pre-release (next) channel
cm update switch --pre-release --json    # Same, JSON envelope
cm update switch --pre-release --ndjson  # Same, newline-delimited JSON envelope
```

### Changelog
```bash
cm changelog                     # Show last 5 versions
cm changelog -n 3                # Show last 3 versions
cm changelog --count 10          # Show last 10 versions
```

## Global Options

```bash
--no-spinner               # Disable loading animations
--progress-jsonl           # Machine-readable progress events (JSONL to stderr)
--progress-jsonl=<path>    # Same, but write events to <path> instead of stderr
--progress-jsonl <path>    # Same as above (space-separated form also accepted)
--accessible               # Add text labels to color-coded output (also: TW_ACCESSIBLE=1)
--non-interactive          # Disable interactive prompts (auto-detected when stdin is not a TTY)
--interactive              # Force interactive mode even when stdin is not a TTY
```

## Output Formats

All list/view commands support:

```bash
--json    # Output as JSON
--ndjson  # Output as newline-delimited JSON (for streaming)
--full    # Include all fields (default shows essential fields only)
```

## Dry Run

Mutating commands accept `--dry-run` to preview the operation without making the change. Where a command performs pre-flight validation (e.g. fetching the target thread to check channel access or ownership), those checks still run in dry-run — only the mutating write is skipped. Commands that have no pre-flight validation parse the reference and print the preview without hitting the API. The preview is structured:

```
[dry-run] Would <action>:
  <Key>: <resolved value>
  ...
Run without --dry-run to execute.
```

## Reference System

Commands accept flexible references:
- **Numeric IDs**: `123` or `id:123`
- **Comms URLs**: Full `https://comms.todoist.com/...` URLs (parsed automatically)
- **Fuzzy names**: For workspaces/users - `"My Workspace"` or partial matches

## Piping Content

Commands that accept content (`thread create`, `thread reply`, `comment update`, `conversation reply`, `msg update`) auto-detect piped stdin:

```bash
cat notes.md | cm thread reply <ref>
cm thread create <channel-ref> "Title" < body.md
echo "Quick reply" | cm conversation reply <ref>
```

If no content argument is provided and no stdin is piped, the CLI opens `$EDITOR` for interactive input. In non-TTY environments (e.g. when called by an agent or in a pipeline), the editor is automatically skipped and the command fails fast with an actionable error message. Use `--non-interactive` to force this behavior even in a TTY, or `--interactive` to override auto-detection.

## Common Workflows

**View by URL (auto-routes to the right command):**
```bash
cm view https://comms.todoist.com/a/1585/ch/100/t/200          # View thread
cm view https://comms.todoist.com/a/1585/ch/100/t/200/c/300     # View comment
cm view https://comms.todoist.com/a/1585/msg/400                 # View conversation
cm view https://comms.todoist.com/a/1585/msg/400/m/500 --json    # View message as JSON
```

**Check inbox and respond:**
```bash
cm inbox --unread --json
cm thread view <id> --unread
cm thread reply <id> "Thanks, I'll look into this."
cm thread done <id>
```

**Search and review:**
```bash
cm mentions --since 2026-04-01 --all --json
cm search "deployment" --type threads --json
cm thread view <thread-id>
```

**Check DMs:**
```bash
cm conversation unread --json
cm conversation view <conversation-id>
cm conversation with "Alice Example"
cm conversation reply <id> "Got it, thanks!"
```

import packageJson from '../../../package.json' with { type: 'json' }

export const SKILL_NAME = 'comms-cli'

export const SKILL_DESCRIPTION =
    'Comms messaging CLI. View and respond to inbox threads, channel threads, direct messages, mentions, and group conversations; search, react, archive, mute, and manage workspaces. Use when the user mentions Comms, asks about their inbox, mentions, threads, DMs, channels, or wants to read or send Comms messages.'

export const SKILL_AUTHOR = 'Doist'

export const SKILL_LICENSE = 'MIT'

export const SKILL_VERSION = packageJson.version

export const SKILL_CONTENT = `# Comms CLI (tdc)

Access Comms messaging via the \`tdc\` CLI. Use when the user asks about their Comms workspaces, threads, messages, or wants to interact with Comms in any way.

## Setup

\`\`\`bash
tdc auth login                    # OAuth login (standard write scopes)
tdc auth login --read-only        # OAuth login with read-only scope
tdc auth login --full-access      # OAuth login with delete/admin scopes
tdc auth login --callback-port <n># Override the local OAuth callback port (default 8766)
tdc auth login --json             # Emit a JSON envelope for scripted / agent use
tdc auth login --ndjson           # Emit an NDJSON envelope for scripted / agent use
tdc auth token                    # Save API token manually (prompts securely; scope unknown, assumed write-capable)
tdc auth status                   # Verify authentication + show mode
tdc auth status --json            # Full status payload as JSON (--ndjson also supported)
tdc auth status --user <ref>      # Target a specific stored account (id, id:<n>, or display name)
tdc --user <ref> auth <status|logout|token view>  # Equivalent to passing --user after the subcommand; other commands accept the flag but ignore it
tdc auth logout                   # Remove saved token and auth metadata
tdc auth logout --json            # Emits \`{"ok": true}\` (--ndjson is silent)
tdc auth logout --user <ref>      # Target a specific stored account; mismatched ref errors with ACCOUNT_NOT_FOUND
tdc auth token view               # Print the saved token to stdout (pipe-safe; refuses if COMMS_API_TOKEN is set)
tdc auth token view --user <ref>  # Print the saved token for a specific stored account
tdc account [list|current|use <ref>|remove <ref>]  # Manage stored accounts; all support --json/--ndjson
                                 # current's payload is {id, label, authMode, authScope, source:"config"} | {source:"env"} | {source:"token-only"}
tdc auth login                    # Re-running auth login with a different OAuth grant adds a NEW account; default stays pinned unless none was set
tdc workspaces                    # List available workspaces
tdc workspace use <ref>           # Set current workspace
tdc completion install            # Install shell completions
tdc config view                   # Show the current CLI configuration file (token masked)
tdc config set <key> <value>      # Set a user preference (e.g. unarchive-new-threads true)
tdc doctor                        # Diagnose CLI setup and environment issues
tdc update                        # Update CLI to latest version
tdc changelog                     # Show recent changelog entries
\`\`\`

OAuth login uses Todoist OAuth for Comms access. The default grant can read Comms data and create/update content or messages. It does not include delete, channel management, or user/workspace write scopes; use \`tdc auth login --full-access\` only when needed. Stored auth uses the system credential manager when available. If secure storage is unavailable, \`tdc\` warns and falls back to \`~/.config/comms-cli/config.json\`. \`COMMS_API_TOKEN\` always takes priority over the stored token.

In read-only mode (\`tdc auth login --read-only\`), commands that modify Comms data (reply, archive, react, delete, etc.) are blocked by the CLI. Externally provided tokens (\`COMMS_API_TOKEN\` or \`tdc auth token\`) are treated as unknown scope and assumed write-capable.

## View by URL

\`\`\`bash
tdc view <url>                    # View any Comms entity by URL
\`\`\`

Routes automatically based on URL structure:
- Message URL → \`tdc msg view\`
- Conversation URL → \`tdc conversation view\`
- Thread+comment URL → \`tdc thread view\` (comment ID extracted from URL)
- Thread URL → \`tdc thread view\`

URLs may use either \`https://comms.todoist.com/{workspaceId}/...\` or \`https://comms.todoist.com/a/{workspaceId}/...\`.

All target command flags pass through (e.g. \`--json\`, \`--raw\`, \`--full\`).

## Inbox

\`\`\`bash
tdc inbox                         # Show inbox threads
tdc inbox --unread                # Only unread threads
tdc inbox --archive-filter all      # Show active + done threads
tdc inbox --archive-filter archived # Show only done threads
tdc inbox --channel <filter>      # Filter by channel name (fuzzy)
tdc inbox --since <date>          # Filter by date (ISO format)
tdc inbox --limit <n>             # Max items (default: 50)
\`\`\`

## Threads

\`\`\`bash
tdc thread <thread-ref>           # View thread (shorthand for view)
tdc thread view <thread-ref>      # View thread with comments
tdc thread view <ref> --comment <id> # View a specific comment
tdc thread view <url-with-/c/id>  # Comment ID extracted from URL
tdc thread view <ref> --unread    # Show only unread comments
tdc thread view <ref> --context 3 # Include 3 read comments before unread
tdc thread view <ref> --limit 20  # Limit number of comments
tdc thread view <ref> --since <date> # Comments newer than date
tdc thread view <ref> --raw       # Show raw markdown
tdc thread create <channel-ref> "Title" "content"    # Create a new thread
tdc thread create <channel-ref> "Title" "content" --json       # Create and return as JSON
tdc thread create <channel-ref> "Title" "content" --json --full # Include all thread fields
tdc thread create <channel-ref> "Title" "content" --notify 123,456  # Notify specific users
tdc thread create <channel-ref> "Title" "content" --unarchive  # Land thread in author's Inbox (overrides default Comms auto-archive)
tdc thread create <channel-ref> "Title" "content" --no-unarchive  # Force archive even when userSettings.unarchiveNewThreads=true
tdc thread create <channel-ref> "Title" "content" --dry-run  # Preview without posting
tdc thread create <channel-ref> "Title" --file ./a.png  # Attach a file (repeatable; content optional)
tdc thread reply <ref> "content"  # Post a comment (notifies EVERYONE_IN_THREAD by default)
tdc thread reply <ref> "content" --notify EVERYONE  # Notify all workspace members
tdc thread reply <ref> "content" --notify 123,id:456   # Notify specific user IDs
tdc thread reply <ref> "content" --json  # Post and return comment as JSON
tdc thread reply <ref> "content" --json --full  # Include all comment fields
tdc thread reply <ref> "content" --close       # Reply and close the thread
tdc thread reply <ref> "content" --reopen      # Reply and reopen a closed thread
tdc thread reply <ref> "content" --file ./a.png  # Attach a file (repeatable; content optional)
tdc thread done <ref>                 # Preview thread archive (requires --yes to execute)
tdc thread done <ref> --yes           # Archive thread (mark done)
tdc thread done <ref> --yes --json    # Archive and return status as JSON
tdc thread mark-read <ref>        # Mark a thread read
tdc thread mark-read <ref> <ref> --yes # Mark multiple threads read
tdc thread mark-read --from-file ids.txt --dry-run # Preview bulk mark-read from file
tdc thread mute <ref>             # Mute thread for 60 minutes (default)
tdc thread mute <ref> --minutes 480  # Mute for custom duration
tdc thread mute <ref> --json      # Mute and return { id, mutedUntil } as JSON
tdc thread mute <ref> --json --full  # Mute and return full thread as JSON
tdc thread unmute <ref>           # Unmute a muted thread
tdc thread unmute <ref> --json    # Unmute and return { id, mutedUntil } as JSON
tdc thread delete <ref>             # Preview thread deletion (requires --yes to execute)
tdc thread delete <ref> --yes       # Permanently delete a thread
tdc thread delete <ref> --yes --json # Delete and return status as JSON
tdc thread rename <ref> "New title"  # Rename a thread (change its title)
tdc thread rename <ref> "New title" --json  # Rename and return { id, title } as JSON
tdc thread rename <ref> "New title" --json --full  # Rename and return full thread as JSON
tdc thread update <ref> "New body"   # Update a thread's body (the first post)
echo "New body" | tdc thread update <ref>  # Update body from stdin
tdc thread update <ref> "New body" --dry-run  # Preview without updating
tdc thread update <ref> "New body" --json  # Update and return { id, content } as JSON
tdc thread update <ref> "New body" --json --full  # Update and return full thread as JSON
\`\`\`

Default \`--notify\` for reply is EVERYONE_IN_THREAD, which may notify more people than intended. Before posting, confirm with the user whether specific people should be notified instead (via \`--notify <user-ids>\`). Options: EVERYONE, EVERYONE_IN_THREAD, or comma-separated ID refs.

\`--notify\` automatically resolves IDs: group IDs are routed to the \`groups\` API field, user IDs to \`recipients\`. No special syntax needed.

## Thread Comments

\`\`\`bash
tdc comment <comment-ref>                       # View a comment (shorthand for view)
tdc comment view <comment-ref>                  # View a single thread comment
tdc comment view <comment-ref> --raw            # Show raw markdown
tdc comment view <comment-ref> --json           # Output as JSON
tdc comment view <comment-ref> --ndjson         # Output as newline-delimited JSON
tdc comment view <comment-ref> --json --full    # Include all fields in JSON output
tdc comment update <comment-ref> "new content"  # Update a thread comment
tdc comment update <comment-ref> "content" --json  # Update and return updated comment as JSON
tdc comment update <comment-ref> "content" --json --full  # Include all comment fields
tdc comment delete <comment-ref>                     # Preview comment deletion (requires --yes to execute)
tdc comment delete <comment-ref> --yes               # Delete a thread comment
tdc comment delete <comment-ref> --yes --json        # Delete and return status as JSON
\`\`\`

## Conversations (DMs/Groups)

\`\`\`bash
tdc conversation unread                    # List unread conversations
tdc conversation <conversation-ref>        # View conversation (shorthand for view)
tdc conversation view <conversation-ref>   # View conversation messages
tdc conversation with <user-ref>           # Find your 1:1 DM with a user
tdc conversation with <user-ref> --snippet # Include the latest message preview
tdc conversation with <user-ref> --include-groups # List any conversations with that user
tdc conversation reply <ref> "content"     # Send a message
tdc conversation reply <ref> "content" --json  # Send and return message as JSON
tdc conversation reply <ref> "content" --json --full  # Include all message fields
tdc conversation reply <ref> "content" --file ./a.png  # Attach a file (repeatable; content optional)
tdc conversation done <ref>                    # Preview conversation archive (requires --yes to execute)
tdc conversation done <ref> --yes              # Archive conversation
tdc conversation done <ref> --yes --json       # Archive and return status as JSON
tdc conversation mute <ref>               # Mute conversation for 60 minutes (default)
tdc conversation mute <ref> --minutes 480 # Mute for custom duration
tdc conversation mute <ref> --json        # Mute and return { id, mutedUntil } as JSON
tdc conversation mute <ref> --json --full # Mute and return full conversation as JSON
tdc conversation unmute <ref>             # Unmute a muted conversation
tdc conversation unmute <ref> --json      # Unmute and return { id, mutedUntil } as JSON
\`\`\`

Alias: \`tdc convo\` works the same as \`tdc conversation\`.

## Conversation Messages

\`\`\`bash
tdc msg <message-ref>             # View a message (shorthand for view)
tdc msg view <message-ref>        # View a single conversation message
tdc msg update <ref> "content"    # Edit a conversation message
tdc msg update <ref> "content" --json  # Edit and return updated message as JSON
tdc msg update <ref> "content" --json --full  # Include all message fields
tdc msg delete <ref>                  # Preview message deletion (requires --yes to execute)
tdc msg delete <ref> --yes            # Delete a conversation message
tdc msg delete <ref> --yes --json     # Delete and return status as JSON
\`\`\`

Alias: \`tdc message\` works the same as \`tdc msg\`.

## Search

\`\`\`bash
tdc mentions                      # Show content mentioning current user
tdc mentions --since 2026-04-01 --all # Fetch every mention since a date
tdc mentions --type threads --json # Limit mentions to threads
tdc search "query"                # Search content
tdc search "query" --type threads # Filter: threads, messages, or all
tdc search "query" --author <ref> # Filter by author
tdc search "query" --to <ref>     # Messages sent to user
tdc search "query" --title-only   # Search thread titles only
tdc search "query" --mention-me   # Results mentioning current user
tdc search "query" --conversation <refs> # Limit to conversations (comma-separated refs)
tdc search "query" --since <date> # Content from date
tdc search "query" --until <date> # Content until date
tdc search "query" --channel <refs> # Filter by channel refs (comma-separated)
tdc search "query" --limit <n>    # Max results (default: 50)
tdc search "query" --cursor <cur> # Pagination cursor
tdc search "query" --all          # Fetch all result pages
\`\`\`

## Users, Channels & Groups

\`\`\`bash
tdc user                          # Show current user info
tdc user --json                   # JSON output
tdc user --json --full            # Include all fields in JSON output
tdc users                         # List active workspace users
tdc users --search <text>         # Filter by name/email
tdc users --include-removed       # Include users removed from the workspace
tdc channels                      # List active joined workspace channels (alias of: tdc channel list)
tdc channels --state all          # Include archived joined channels too
tdc channels --scope discoverable # Active public channels you can see but have not joined
tdc channels --scope public --state all --json # All visible public channels, with joined status
tdc channel create "Engineering"  # Create a channel in the current workspace
tdc channel create "Leadership Team" --private --users id:10,id:20 # Create private channel with initial members
tdc channel create "Product" --workspace "Doist" --description "Product discussions" --json # Create and return channel as JSON
tdc channel update <channel-ref> "New name" # Rename a channel
tdc channel update <ref> --name "New name" # Rename with an explicit flag
tdc channel update <ref> --description "Team discussions" # Update channel description
tdc channel update <ref> --clear-description # Clear channel description
tdc channel update <ref> --public # Make a channel public (--private makes it private)
tdc channel update <ref> --description "Team discussions" --json --full # Update and return all channel fields
tdc channel delete <channel-ref> --yes # Permanently delete a channel (requires --yes; usually admin-only)
tdc channel delete <ref> --dry-run # Preview deletion
tdc channel archive <channel-ref> # Archive a channel (no-op if already archived)
tdc channel unarchive id:<id> # Unarchive a channel (pass id:/numeric ref for archived channels)
tdc channel threads <channel-ref>  # List threads in a channel (fuzzy name, id:, numeric ID, or URL)
tdc channel threads "general" --unread       # Only unread threads
tdc channel threads <ref> --archive-filter all  # Include archived threads (active|archived|all)
tdc channel threads <ref> --since 2026-01-01 # Filter by last-updated date (ISO)
tdc channel threads <ref> --limit 20         # Max threads per page (default: 50)
tdc channel threads <ref> --limit 20 --cursor <cursor-from-prev> # Paginate
tdc channel threads <ref> --json  # { results, nextCursor } with isUnread + url
tdc channel members <channel-ref> # List a channel's members + groups fully in the channel
tdc channel members <ref> --json  # JSON with id, name, workspaceId, members
tdc channel members add <ref> alice group:Design # Add users and/or expand group:<ref> members
tdc channel members add <ref> a@d.com id:789 --json # Add refs, output result as JSON
tdc channel members remove <ref> alice group:Frontend # Remove users and/or group members
tdc channel members set <ref> group:Squad --apply # Replace membership with the resolved set
tdc channel members set <ref> alice bob # Dry-run by default; refuses to remove you (--include-self to override)
tdc groups                        # List workspace groups
tdc groups --search "frontend"    # Filter groups by name (case-insensitive)
tdc groups --json                 # JSON output
tdc groups --json --full          # Include all fields in JSON output
tdc groups view <group-ref>       # Show group with member details
tdc groups view <ref> --json      # JSON output with id, name, workspaceId, members
tdc groups view <ref> --json --full  # Include all fields in JSON output
tdc groups create "Name"          # Create a new group
tdc groups create "Name" --users alice@doist.com,bob@doist.com  # Create with members
tdc groups create "Name" --json   # Output created group as JSON
tdc groups rename <group-ref> "New name"  # Rename a group
tdc groups rename <ref> "Name" --json     # Output renamed group as JSON
tdc groups delete <group-ref> --yes       # Delete a group (requires --yes)
tdc groups delete <ref> --dry-run         # Preview deletion
tdc groups add-user <group-ref> user1 user2   # Add users to a group
tdc groups add-user <ref> a@d.com,b@d.com     # Comma-separated refs
tdc groups add-user <ref> id:123 --json       # Output result as JSON
tdc groups remove-user <group-ref> user1 user2  # Remove users from a group
tdc groups remove-user <ref> id:123,id:456      # Comma-separated ID refs
\`\`\`

If a channel is not found in \`tdc channels\`, widen with broader listings such as \`tdc channels --scope public\`, then \`tdc channels --scope public --state all\`. Check \`tdc channels --help\` for other available filters.

\`tdc channel threads\` returns every thread in the channel; pagination filters (\`--limit\`, \`--cursor\`, \`--since\`, \`--until\`, \`--unread\`) are applied client-side after fetch. \`--archive-filter\` is applied server-side. Results are sorted newest-first by last activity. In \`--json\` / \`--ndjson\`, the response includes a \`nextCursor\` string (opaque) you can pass via \`--cursor\` to fetch the next page; NDJSON emits the cursor as a final \`{ "_meta": true, "nextCursor": "..." }\` line.

For \`tdc channel members add/remove/set\`, refs accept user identifiers (\`id:N\`, email, name) or \`group:<ref>\`, which expands to the group's current members. Group expansion is one-shot — it is not a persistent link, so users added to the group later will not auto-join the channel. \`set\` replaces membership with the resolved set and is dry-run by default (pass \`--apply\` to mutate); it refuses to remove the acting user unless \`--include-self\` is passed.

## Reactions

\`\`\`bash
tdc react thread <ref> 👍         # Add reaction to thread
tdc react comment <ref> +1        # Add reaction (shortcode)
tdc react message <ref> heart     # Add reaction to DM message
tdc react thread <ref> 👍 --json  # Output result as JSON
tdc unreact thread <ref> 👍       # Remove reaction
tdc unreact thread <ref> 👍 --json # Output result as JSON
\`\`\`

Supported shortcodes: +1, -1, heart, tada, smile, laughing, thinking, fire, check, x, eyes, pray, clap, rocket, wave

## Shell Completions

\`\`\`bash
tdc completion install            # Install tab completions (prompts for shell)
tdc completion install bash       # Install for specific shell
tdc completion install zsh
tdc completion install fish
tdc completion uninstall          # Remove completions
\`\`\`

### Diagnostics

\`\`\`bash
tdc doctor                        # Run local + network diagnostics
tdc doctor --offline              # Skip Comms and npm network checks
tdc doctor --json                 # JSON output with per-check results
\`\`\`

### Configuration

\`\`\`bash
tdc config view                   # Pretty-printed config, token masked, labels actual token source
tdc config view --json            # Raw JSON, token masked
tdc config view --show-token      # Include the full token
tdc config set unarchive-new-threads true   # Persist: always unarchive new threads so they land in your Inbox
tdc config set unarchive-new-threads false  # Persist: keep Comms's default (thread auto-archived for author)
\`\`\`

User preferences are stored under \`userSettings\` in the config file. Currently supported keys: \`unarchive-new-threads\`. The flag on \`tdc thread create\` (\`--unarchive\` / \`--no-unarchive\`) overrides this default per-invocation.

### Update

\`\`\`bash
tdc update                        # Update CLI to latest version
tdc update --check                # Check for updates without installing, show channel
tdc update --check --json         # Same, JSON envelope
tdc update --check --ndjson       # Same, newline-delimited JSON envelope
tdc update --channel              # Show current update channel
tdc update switch --stable        # Switch to stable release channel
tdc update switch --pre-release   # Switch to pre-release (next) channel
tdc update switch --pre-release --json    # Same, JSON envelope
tdc update switch --pre-release --ndjson  # Same, newline-delimited JSON envelope
\`\`\`

### Changelog
\`\`\`bash
tdc changelog                     # Show last 5 versions
tdc changelog -n 3                # Show last 3 versions
tdc changelog --count 10          # Show last 10 versions
\`\`\`

## Global Options

\`\`\`bash
--no-spinner               # Disable loading animations
--progress-jsonl           # Machine-readable progress events (JSONL to stderr)
--progress-jsonl=<path>    # Same, but write events to <path> instead of stderr
--progress-jsonl <path>    # Same as above (space-separated form also accepted)
--accessible               # Add text labels to color-coded output (also: TDC_ACCESSIBLE=1)
--non-interactive          # Disable interactive prompts (auto-detected when stdin is not a TTY)
--interactive              # Force interactive mode even when stdin is not a TTY
\`\`\`

## Output Formats

All list/view commands support:

\`\`\`bash
--json    # Output as JSON
--ndjson  # Output as newline-delimited JSON (for streaming)
--full    # Include all fields (default shows essential fields only)
\`\`\`

## Dry Run

Mutating commands accept \`--dry-run\` to preview the operation without making the change. Where a command performs pre-flight validation (e.g. fetching the target thread to check channel access or ownership), those checks still run in dry-run — only the mutating write is skipped. Commands that have no pre-flight validation parse the reference and print the preview without hitting the API. The preview is structured:

\`\`\`
[dry-run] Would <action>:
  <Key>: <resolved value>
  ...
Run without --dry-run to execute.
\`\`\`

## Reference System

Commands accept flexible references:
- **Numeric IDs**: \`123\` or \`id:123\`
- **Comms URLs**: Full \`https://comms.todoist.com/...\` URLs (parsed automatically)
- **Fuzzy names**: For workspaces/users - \`"My Workspace"\` or partial matches

## Piping Content

Commands that accept content (\`thread create\`, \`thread reply\`, \`comment update\`, \`conversation reply\`, \`msg update\`) auto-detect piped stdin:

\`\`\`bash
cat notes.md | tdc thread reply <ref>
tdc thread create <channel-ref> "Title" < body.md
echo "Quick reply" | tdc conversation reply <ref>
\`\`\`

If no content argument is provided and no stdin is piped, the CLI opens \`$EDITOR\` for interactive input. In non-TTY environments (e.g. when called by an agent or in a pipeline), the editor is automatically skipped and the command fails fast with an actionable error message. Use \`--non-interactive\` to force this behavior even in a TTY, or \`--interactive\` to override auto-detection.

## Common Workflows

**View by URL (auto-routes to the right command):**
\`\`\`bash
tdc view https://comms.todoist.com/1585/ch/100/t/200            # View thread
tdc view https://comms.todoist.com/a/1585/ch/100/t/200          # View thread
tdc view https://comms.todoist.com/a/1585/ch/100/t/200/c/300     # View comment
tdc view https://comms.todoist.com/a/1585/msg/400                 # View conversation
tdc view https://comms.todoist.com/a/1585/msg/400/m/500 --json    # View message as JSON
\`\`\`

**Check inbox and respond:**
\`\`\`bash
tdc inbox --unread --json
tdc thread view <id> --unread
tdc thread reply <id> "Thanks, I'll look into this."
tdc thread done <id> --yes
\`\`\`

**Search and review:**
\`\`\`bash
tdc mentions --since 2026-04-01 --all --json
tdc search "deployment" --type threads --json
tdc thread view <thread-id>
\`\`\`

**Check DMs:**
\`\`\`bash
tdc conversation unread --json
tdc conversation view <conversation-id>
tdc conversation with "Alice Example"
tdc conversation reply <id> "Got it, thanks!"
\`\`\`
`

export const SKILL_FILE_CONTENT = `---
name: ${SKILL_NAME}
description: ${JSON.stringify(SKILL_DESCRIPTION)}
license: ${SKILL_LICENSE}
metadata:
  author: ${SKILL_AUTHOR}
  version: ${JSON.stringify(SKILL_VERSION)}
---

${SKILL_CONTENT}`

# comms-cli Specification

A command-line interface for Comms, following the architecture and patterns established by `todoist-cli`.

## Tech Stack

- **Runtime**: Node.js ≥ 18
- **Language**: TypeScript 5.x (strict mode)
- **CLI Framework**: Commander.js
- **Terminal Styling**: chalk
- **API Client**: `@doist/comms-sdk`
- **Testing**: vitest
- **Formatting**: prettier
- **Git Hooks**: lefthook

## Project Structure

```
src/
├── index.ts                 # Entry point, command registration
├── commands/                # Command implementations
│   ├── inbox.ts            # Inbox threads
│   ├── thread.ts           # Thread view, reply, done
│   ├── conversation.ts     # Conversations (DMs/group messages)
│   ├── msg.ts              # Conversation message operations
│   ├── workspace.ts        # Workspace listing and selection
│   ├── user.ts             # User info/listing
│   ├── search.ts           # Content search
│   ├── channel.ts          # Channel listing
│   └── react.ts            # Emoji reactions
└── lib/                     # Shared utilities
    ├── api.ts              # API client wrapper, caching
    ├── auth.ts             # Token management
    ├── config.ts           # Config file management (current workspace)
    ├── output.ts           # Formatting (colors, JSON, markdown)
    ├── refs.ts             # Reference resolution (ID/URL parsing)
    ├── pagination.ts       # Timestamp-based pagination
    └── dates.ts            # Relative date formatting

__tests__/                   # Test suite
```

## Package & Binary

- **Package name**: `@doist/comms-cli`
- **Binary**: `cm`

## Authentication

Token resolution (priority order):

1. Environment variable: `COMMS_API_TOKEN`
2. System credential manager (Keychain, Credential Manager, or Secret Service)
3. Legacy plaintext token in `~/.config/comms-cli/config.json` during auto-migration
4. Plaintext config fallback when the OS credential store is unavailable

## Workspace Scoping

Commands that require a workspace context use this resolution order:

1. `--workspace <ref>` flag (if provided)
2. Config-stored current workspace (`cm workspace use <ref>`)
3. User's default workspace from API (auto-stored to config on first use)

---

## Commands

### Workspace Commands

#### `cm workspaces`

List all workspaces the user belongs to.

Options:

- `--json` / `--ndjson` - Machine-readable output

#### `cm workspace use <workspace-ref>`

Set the current workspace for subsequent commands.

Arguments:

- `workspace-ref` - Workspace ID or name

---

### User Commands

#### `cm user`

Display current user info (name, email, timezone, default workspace).

#### `cm users [workspace-ref]`

List users in a workspace.

Arguments:

- `workspace-ref` - Workspace ID or name (uses current workspace if omitted)

Options:

- `--search <text>` - Filter by name/email
- `--json` / `--ndjson` - Machine-readable output

---

### Channel Commands

#### `cm channels [workspace-ref]`

List channels in a workspace.

Arguments:

- `workspace-ref` - Workspace ID or name (uses current workspace if omitted)

Options:

- `--json` / `--ndjson` - Machine-readable output

---

### Inbox Commands

#### `cm inbox [workspace-ref]`

Show inbox threads (mirrors Comms UI inbox - threads only, not DMs).

Arguments:

- `workspace-ref` - Workspace ID or name (uses current workspace if omitted)

Options:

- `--unread` - Only show unread threads
- `--since <date>` - Filter by date (ISO format)
- `--until <date>` - Filter by date
- `--limit <n>` - Max items (default: 50)
- `--json` / `--ndjson` - Machine-readable output

Output format (human-readable):

- Title, channel name, timestamp (relative), unread indicator
- URL on second line for each entry
- Content truncated in list view

---

### Thread Commands

#### `cm thread view <thread-ref>`

Display a thread with its comments.

Arguments:

- `thread-ref` - Thread ID or Comms URL

Options:

- `--limit <n>` - Max comments to show (default: 50)
- `--since <date>` - Comments newer than
- `--until <date>` - Comments older than
- `--raw` - Show raw markdown instead of rendered
- `--json` / `--ndjson` - Machine-readable output

Output:

- Full thread content with markdown rendered (unless `--raw`)
- Comments with full content (detail view = no truncation)

#### `cm thread reply <thread-ref> [content]`

Post a comment to a thread.

Arguments:

- `thread-ref` - Thread ID or Comms URL
- `content` - Comment content (optional if using stdin or editor)

Content input priority:

1. Stdin (if piped: `echo "text" | cm thread reply id:123`)
2. Argument (if provided)
3. Opens `$EDITOR` (if neither stdin nor argument)

Options:

- `--dry-run` - Show what would be posted without posting

Output:

- Minimal confirmation with comment-specific URL

#### `cm thread done <thread-ref>`

Archive a thread (mark as done).

Arguments:

- `thread-ref` - Thread ID or Comms URL

Options:

- `--dry-run` - Show what would happen without executing

---

### Conversation Commands

Alias: `convo`. Conversations are DM/group containers.

#### `cm conversation unread [workspace-ref]`

List unread conversations.

Arguments:

- `workspace-ref` - Workspace ID or name (uses current workspace if omitted)

Options:

- `--json` / `--ndjson` - Machine-readable output

Output format:

- Participants + unread count (e.g., "Conversation with John, Jane (3 unread)")
- URL on second line
- No message preview (privacy)

#### `cm conversation view <conversation-ref>`

Display a conversation with its messages.

Arguments:

- `conversation-ref` - Conversation ID or Comms URL

Options:

- `--limit <n>` - Max messages to show (default: 50)
- `--since <date>` - Messages newer than
- `--until <date>` - Messages older than
- `--raw` - Show raw markdown instead of rendered
- `--json` / `--ndjson` - Machine-readable output

#### `cm conversation reply <conversation-ref> [content]`

Send a message in a conversation.

Arguments:

- `conversation-ref` - Conversation ID or Comms URL
- `content` - Message content (optional if using stdin or editor)

Content input: Same as `cm thread reply` (stdin → arg → $EDITOR)

Options:

- `--dry-run` - Show what would be sent without sending

Output:

- Minimal confirmation with message-specific URL

#### `cm conversation done <conversation-ref>`

Archive a conversation.

Arguments:

- `conversation-ref` - Conversation ID or Comms URL

Options:

- `--dry-run` - Show what would happen without executing

---

### Conversation Message Commands

Alias: `message`. Operations on individual messages within conversations.

#### `cm msg view <message-ref>`

View a single conversation message.

Arguments:

- `message-ref` - Message ID or Comms URL

Options:

- `--raw` - Show raw markdown instead of rendered
- `--json` / `--ndjson` - Machine-readable output

#### `cm msg update <message-ref> [content]`

Edit a conversation message.

Arguments:

- `message-ref` - Message ID or Comms URL
- `content` - New message content (optional if using stdin or editor)

Content input: Same as `cm thread reply` (stdin → arg → $EDITOR)

Options:

- `--dry-run` - Show what would be updated without updating

#### `cm msg delete <message-ref>`

Delete a conversation message.

Arguments:

- `message-ref` - Message ID or Comms URL

Options:

- `--dry-run` - Show what would happen without executing

---

### Search Commands

#### `cm search <query> [workspace-ref]`

Search content across a workspace.

Arguments:

- `query` - Search query
- `workspace-ref` - Workspace ID or name (uses current workspace if omitted)

Options:

- `--channel <channel-refs>` - Filter by channels (comma-separated IDs)
- `--author <user-refs>` - Filter by author (comma-separated IDs)
- `--mention-me` - Only results mentioning current user
- `--since <date>` - Content from date
- `--until <date>` - Content until date
- `--limit <n>` - Max results (default: 50)
- `--cursor <cursor>` - Pagination cursor
- `--json` / `--ndjson` - Machine-readable output

---

### Reaction Commands

#### `cm react <target-type> <target-ref> <emoji>`

Add an emoji reaction.

Arguments:

- `target-type` - One of: `thread`, `comment`, `message`
- `target-ref` - Target ID
- `emoji` - Emoji shortcode (`+1`, `heart`) or actual emoji (`👍`)

Options:

- `--dry-run` - Show what would happen without executing

Output displays actual emoji character.

#### `cm unreact <target-type> <target-ref> <emoji>`

Remove an emoji reaction.

Arguments:

- Same as `cm react`

Options:

- `--dry-run` - Show what would happen without executing

---

## Reference Resolution

Commands support these reference formats:

- `id:123456` - Direct ID lookup
- `123456` - Bare ID (when unambiguous context)
- Full Comms URLs - Parsed to extract IDs
- `"Workspace Name"` - Name matching for workspaces only (case-insensitive)

Threads, comments, messages, and conversations: **ID or URL only** (no name lookup).

---

## Output Formatting

### Human-Readable (Default)

**Timestamps**: Relative format ("2 hours ago", "yesterday", "Jan 5")

**Content rendering**:

- Full markdown rendering by default (bold, code blocks, etc.)
- `--raw` flag shows raw markdown
- Markdown library choice deferred - start with raw, add rendering later

**Truncation**:

- List views (inbox, search): Truncate long content
- Detail views (thread view, msg view): Show full content

**Colors**:

- Unread: bold
- Creator/author: cyan
- Timestamps: dim
- Channel names: blue

### Machine-Readable

- `--json` - Pretty-printed JSON with metadata
- `--ndjson` - Newline-delimited JSON (one object per line)
- `--full` - Include all fields (default shows essential fields)

### Essential Fields by Entity

**Thread**: id, title, channelId, channelName, workspaceId, creator, posted, commentCount, isArchived, inInbox, isUnread, url

**Comment**: id, content, creator, threadId, posted, url

**Conversation**: id, workspaceId, userIds, participantNames, title, messageCount, lastActive, archived, url

**Message**: id, content, creator, conversationId, posted, url

**Workspace**: id, name, creator, plan

**User**: id, name, email, timezone, userType

**Channel**: id, name, workspaceId

---

## Pagination

Timestamp-based pagination for threads, comments, messages:

- `--since <date>` / `--until <date>` - Filter by time range
- `--limit <n>` - Max items per request

Cursor-based pagination for search:

- `--cursor <cursor>` - Resume from cursor
- Output includes `nextCursor` when more results available

---

## Error Handling

- Clear error messages without hints (minimal)
- Exit codes: 0=success, 1=error
- Errors written to stderr

---

## Config File

Location: `~/.config/comms-cli/config.json`

```json
{
    "currentWorkspace": 12345
}
```

`token` may appear temporarily in legacy installs before migration, or as a fallback when the system credential manager is unavailable.

---

## Examples

```bash
# Set current workspace
cm workspace use "My Team"

# View inbox
cm inbox
cm inbox --unread

# View a thread
cm thread view id:123456
cm thread view https://comms.todoist.com/a/12345/ch/67890/t/123456

# Reply to a thread
cm thread reply id:123456 "Great idea!"
echo "Multiline\nreply" | cm thread reply id:123456
cm thread reply id:123456  # opens $EDITOR

# Mark thread as done
cm thread done id:123456

# List unread conversations
cm conversation unread

# View and reply to a conversation
cm conversation view id:456789
cm conversation reply id:456789 "Thanks!"

# Search
cm search "quarterly report"
cm search "bug fix" --author id:123 --since 2024-01-01

# React to content
cm react thread id:123456 +1
cm react comment id:789 👍
cm unreact message id:456 heart

# List channels and users
cm channels
cm users --search "john"

# Dry run before mutating
cm thread reply id:123 "test" --dry-run
cm thread done id:123 --dry-run

# JSON output for scripting
cm inbox --json
cm search "project" --ndjson
```

---

## Not in MVP (Future Considerations)

- `cm conversation start` - Start new conversations
- `cm thread done --all` - Bulk archive
- `cm link` command - URLs shown in output instead
- `cm open` - Open in browser
- `cm star` / `cm mute` - Star/mute content
- `cm unread` - Unified unread view (threads + messages)

---

## Implementation Notes

1. **API Client Singleton**: Lazy-initialize `CommsClient` on first use

2. **Workspace Caching**: Cache current workspace in config, auto-fetch from API default if not set

3. **URL Parsing**: Support full Comms URLs, extract workspace/channel/thread/comment/conversation/message IDs

4. **Batch Operations**: Use `client.batch()` for parallel API calls when fetching related data (channels, users for display)

5. **Content Input**: For reply commands, check stdin first, then arg, then spawn $EDITOR

6. **Markdown Rendering**: Defer library choice. Start with raw markdown, add terminal rendering later based on real usage

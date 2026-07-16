import { Command, Option } from 'commander'
import { withCaseInsensitiveChoices } from '../../lib/completion.js'
import { collect } from '../../lib/options.js'
import { markConversationDone } from './done.js'
import { listConversations } from './list.js'
import { muteConversation } from './mute.js'
import { replyToConversation } from './reply.js'
import { unmuteConversation } from './unmute.js'
import { showUnread } from './unread.js'
import { viewConversation } from './view.js'
import { findConversationWithUser } from './with.js'

export function registerConversationCommand(program: Command): void {
    const conversation = program
        .command('conversation')
        .alias('convo')
        .description('Conversation (DM/group) operations')

    conversation
        .command('unread [workspace-ref]')
        .description('List unread conversations')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc conversation unread
  tdc conversation unread --json`,
        )
        .action(showUnread)

    conversation
        .command('list [workspace-ref]')
        .description('List conversations, filtered by participant, name, or kind')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option(
            '--participant <user-refs>',
            'Only conversations including these users (comma-separated: id:N, email, or name)',
        )
        .option('--name <substr>', 'Filter by conversation title (case-insensitive substring)')
        .addOption(
            withCaseInsensitiveChoices(
                new Option('--kind <kind>', 'Filter by kind: group (3+ people) or direct (1:1)'),
                ['group', 'direct'],
            ),
        )
        .addOption(
            withCaseInsensitiveChoices(
                new Option(
                    '--state <state>',
                    'Conversation state: active, all, or archived (default: active)',
                ),
                ['active', 'all', 'archived'],
            ),
        )
        .option('--snippet', 'Include the latest message snippet in text output')
        .option('--limit <n>', 'Maximum conversations to show (default: all)')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc conversation list
  tdc conversation list --kind group
  tdc conversation list --participant "Jane Smith"
  tdc conversation list --participant alice@doist.com,bob@doist.com --kind group
  tdc conversation list --name "release" --snippet
  tdc conversation list --state archived --json
  tdc conversation list --kind direct --limit 20

Notes:
  Defaults to active conversations. --participant keeps conversations that
  include ALL of the given users. --kind group lists conversations with 3+
  people; --kind direct lists 1:1s (and your self-conversation).`,
        )
        .action(listConversations)

    conversation
        .command('view [conversation-ref]', { isDefault: true })
        .description('Display a conversation with its messages')
        .option('--limit <n>', 'Max messages to show (default: 50)')
        .option('--since <date>', 'Messages newer than')
        .option('--until <date>', 'Messages older than')
        .option('--raw', 'Show raw markdown instead of rendered')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc conversation id:CbV8n2Kp4Qx6Rz9Lm3Va
  tdc conversation view id:CbV8n2Kp4Qx6Rz9Lm3Va --limit 20
  tdc conversation view id:CbV8n2Kp4Qx6Rz9Lm3Va --since 2025-01-01 --json`,
        )
        .action((ref, options) => {
            if (!ref) {
                conversation.help()
                return
            }
            return viewConversation(ref, options)
        })

    conversation
        .command('with <user-ref> [workspace-ref]')
        .description('Find your 1:1 conversation with a user')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option('--include-groups', 'List any conversation that includes this user')
        .option('--snippet', 'Include the latest message snippet in text output')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc conversation with "Jane Smith"
  tdc conversation with id:5678 --json
  tdc conversation with "Jane" --include-groups --snippet`,
        )
        .action(findConversationWithUser)

    conversation
        .command('reply <conversation-ref> [content]')
        .description('Send a message in a conversation')
        .option('--file <path>', 'Attach a file (repeatable; content optional)', collect, [])
        .option('--dry-run', 'Show what would be sent without sending')
        .option('--json', 'Output sent message as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc conversation reply id:CbV8n2Kp4Qx6Rz9Lm3Va "Hello!"
  echo "Message body" | tdc conversation reply id:CbV8n2Kp4Qx6Rz9Lm3Va
  tdc conversation reply id:CbV8n2Kp4Qx6Rz9Lm3Va "Update" --json
  tdc conversation reply id:CbV8n2Kp4Qx6Rz9Lm3Va "See attached" --file ./photo.jpg`,
        )
        .action(replyToConversation)

    conversation
        .command('done <conversation-ref>')
        .description('Archive a conversation')
        .option('--yes', 'Confirm archive')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .addHelpText(
            'after',
            `
Examples:
  tdc conversation done id:CbV8n2Kp4Qx6Rz9Lm3Va --yes
  tdc conversation done id:CbV8n2Kp4Qx6Rz9Lm3Va --dry-run`,
        )
        .action(markConversationDone)

    conversation
        .command('mute <conversation-ref>')
        .description('Mute a conversation (stop notifications)')
        .option('--minutes <n>', 'Number of minutes to mute (default: 60)')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc conversation mute id:CbV8n2Kp4Qx6Rz9Lm3Va
  tdc conversation mute id:CbV8n2Kp4Qx6Rz9Lm3Va --minutes 480`,
        )
        .action(muteConversation)

    conversation
        .command('unmute <conversation-ref>')
        .description('Unmute a muted conversation (restore notifications)')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc conversation unmute id:CbV8n2Kp4Qx6Rz9Lm3Va`,
        )
        .action(unmuteConversation)
}

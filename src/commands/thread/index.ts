import { Command, Option } from 'commander'
import { withUnvalidatedChoices } from '../../lib/completion.js'
import { collect } from '../../lib/options.js'
import { createThread } from './create.js'
import { deleteThread } from './delete.js'
import { markThreadDone } from './mutate.js'
import { muteThread, unmuteThread } from './mute.js'
import { markThreadRead } from './read.js'
import { renameThread } from './rename.js'
import { replyToThread } from './reply.js'
import { updateThread } from './update.js'
import { viewThread } from './view.js'

export function registerThreadCommand(program: Command): void {
    const thread = program.command('thread').description('Thread operations')

    thread
        .command('view [thread-ref]', { isDefault: true })
        .description('Display a thread with its comments')
        .option('--comment <id>', 'Show only a specific comment')
        .option('--unread', 'Show only unread comments (with original post for context)')
        .option('--context <n>', 'Include N read comments before unread (use with --unread)')
        .option('--limit <n>', 'Max comments to show (default: 50)')
        .option('--since <date>', 'Comments newer than')
        .option('--until <date>', 'Comments older than')
        .option('--raw', 'Show raw markdown instead of rendered')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread id:CbT8n2Kp4Qx6Rz9Lm3Va
  tdc thread view id:CbT8n2Kp4Qx6Rz9Lm3Va --unread
  tdc thread view id:CbT8n2Kp4Qx6Rz9Lm3Va --limit 10 --json`,
        )
        .action((ref, options) => {
            if (!ref) {
                thread.help()
                return
            }
            return viewThread(ref, options)
        })

    thread
        .command('reply <thread-ref> [content]')
        .description('Post a comment to a thread')
        .addOption(
            withUnvalidatedChoices(
                new Option(
                    '--notify <recipients>',
                    'Notification recipients: EVERYONE, EVERYONE_IN_THREAD, or comma-separated user and/or group IDs (default: EVERYONE_IN_THREAD)',
                ),
                ['EVERYONE', 'EVERYONE_IN_THREAD'],
            ),
        )
        .option('--close', 'Close the thread after replying')
        .option('--reopen', 'Reopen the thread after replying')
        .option('--file <path>', 'Attach a file (repeatable; content optional)', collect, [])
        .option('--dry-run', 'Show what would be posted without posting')
        .option('--json', 'Output posted comment as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread reply id:CbT8n2Kp4Qx6Rz9Lm3Va "Sounds good!"
  echo "Long reply" | tdc thread reply id:CbT8n2Kp4Qx6Rz9Lm3Va
  tdc thread reply id:CbT8n2Kp4Qx6Rz9Lm3Va "Done" --close --json
  tdc thread reply id:CbT8n2Kp4Qx6Rz9Lm3Va "Heads up" --notify 67890,Cbzzm11ZeYZoJYD4a6rti
  tdc thread reply id:CbT8n2Kp4Qx6Rz9Lm3Va "See attached" --file ./diagram.png
  tdc thread reply id:CbT8n2Kp4Qx6Rz9Lm3Va --file ./a.png --file ./b.pdf`,
        )
        .action(replyToThread)

    thread
        .command('create <channel-ref> <title> [content]')
        .description('Create a new thread in a channel')
        .option('--notify <recipients>', 'Comma-separated user and/or group IDs to notify')
        .option(
            '--unarchive',
            'Unarchive after creation so the thread appears in your Inbox (overrides userSettings.unarchiveNewThreads when false)',
        )
        .option('--no-unarchive', 'Skip unarchive even if userSettings.unarchiveNewThreads is true')
        .option('--file <path>', 'Attach a file (repeatable; content optional)', collect, [])
        .option('--dry-run', 'Show what would be posted without posting')
        .option('--json', 'Output created thread as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread create id:CbC8n2Kp4Qx6Rz9Lm3Va "Weekly update" "Here's what happened..."
  echo "Body from stdin" | tdc thread create id:CbC8n2Kp4Qx6Rz9Lm3Va "Title"
  tdc thread create id:CbC8n2Kp4Qx6Rz9Lm3Va "Title" "Body" --notify 67890,11111 --json
  tdc thread create id:CbC8n2Kp4Qx6Rz9Lm3Va "Title" "Body" --unarchive
  tdc thread create id:CbC8n2Kp4Qx6Rz9Lm3Va "Title" --file ./report.pdf`,
        )
        .action(createThread)

    thread
        .command('done <thread-ref>')
        .description('Archive a thread (mark as done)')
        .option('--yes', 'Confirm archive')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread done id:CbT8n2Kp4Qx6Rz9Lm3Va --yes
  tdc thread done id:CbT8n2Kp4Qx6Rz9Lm3Va --dry-run
  tdc thread done id:CbT8n2Kp4Qx6Rz9Lm3Va --json --yes`,
        )
        .action(markThreadDone)

    const markReadCmd = thread
        .command('mark-read [thread-refs...]')
        .description('Mark a thread read for the current user')
        .option('--yes', 'Skip confirmation for bulk operations')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread mark-read id:CbT8n2Kp4Qx6Rz9Lm3Va
  tdc thread mark-read id:CbT8n2Kp4Qx6Rz9Lm3Va id:CbT9m4Qr7Vz2Nx8Lp5Sa --yes
  printf "id:CbT8n2Kp4Qx6Rz9Lm3Va\\nid:CbT9m4Qr7Vz2Nx8Lp5Sa\\n" | tdc thread mark-read --yes`,
        )
        .action((refs, options) => {
            if (refs.length === 0 && process.stdin.isTTY) {
                markReadCmd.help()
                return
            }
            return markThreadRead(refs, options)
        })

    thread
        .command('delete <thread-ref>')
        .description('Permanently delete a thread')
        .option('--yes', 'Confirm deletion')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread delete id:CbT8n2Kp4Qx6Rz9Lm3Va --yes
  tdc thread delete id:CbT8n2Kp4Qx6Rz9Lm3Va --dry-run
  tdc thread delete id:CbT8n2Kp4Qx6Rz9Lm3Va --yes --json`,
        )
        .action(deleteThread)

    thread
        .command('mute <thread-ref>')
        .description('Mute a thread (stop inbox notifications)')
        .option('--minutes <n>', 'Number of minutes to mute (default: 60)')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread mute id:CbT8n2Kp4Qx6Rz9Lm3Va
  tdc thread mute id:CbT8n2Kp4Qx6Rz9Lm3Va --minutes 480`,
        )
        .action(muteThread)

    thread
        .command('rename <thread-ref> <title>')
        .description('Rename a thread (change its title)')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include all fields in JSON output')
        .action(renameThread)

    thread
        .command('update <thread-ref> [content]')
        .description("Update a thread's body (the first post)")
        .option('--dry-run', 'Show what would be updated without updating')
        .option('--json', 'Output updated thread as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread update id:CbT8n2Kp4Qx6Rz9Lm3Va "Updated body text"
  echo "New body" | tdc thread update id:CbT8n2Kp4Qx6Rz9Lm3Va
  tdc thread update id:CbT8n2Kp4Qx6Rz9Lm3Va "Fixed" --json`,
        )
        .action(updateThread)

    thread
        .command('unmute <thread-ref>')
        .description('Unmute a muted thread (restore inbox notifications)')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc thread unmute id:CbT8n2Kp4Qx6Rz9Lm3Va`,
        )
        .action(unmuteThread)
}

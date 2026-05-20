import { Command, Option } from 'commander'
import { withCaseInsensitiveChoices } from '../../lib/completion.js'
import { listChannels } from './list.js'
import { showChannelThreads } from './threads.js'

export function registerChannelCommand(program: Command): void {
    const channel = program
        .command('channel')
        .alias('channels')
        .description('Channel operations (list, threads)')

    channel
        .command('list [workspace-ref]', { isDefault: true })
        .description('List joined channels or discoverable public channels in a workspace')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option(
            '--scope <scope>',
            'Channel set to list: joined, public, or discoverable (default: joined)',
        )
        .option(
            '--state <state>',
            'Channel state to list: active, all, or archived (default: active)',
        )
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc channels
  tdc channels --state all
  tdc channels --scope discoverable
  tdc channels --scope public --state archived
  tdc channels --scope public --state all --json
  tdc channels --json
  tdc channels "My Workspace" --scope discoverable --json

Notes:
  Defaults to active channels that you have joined.
  joined        Channels you have joined (private channels require --include-private-channels)
  public        Public channels visible in the workspace, whether joined or not
  discoverable  Public channels visible in the workspace that you have not joined
  active        Non-archived channels only
  all           Both active and archived channels
  archived      Archived channels only

  Comms does not expose unjoined private channels, so public/discoverable scopes never include them.`,
        )
        .action(listChannels)

    channel
        .command('threads <channel-ref> [workspace-ref]')
        .description('List threads in a channel with pagination and filtering')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option('--unread', 'Only show unread threads')
        .addOption(
            withCaseInsensitiveChoices(
                new Option(
                    '--archive-filter <filter>',
                    'Show active, archived, or all threads (default: active)',
                ),
                ['active', 'archived', 'all'],
            ),
        )
        .option('--since <date>', 'Threads updated on/after this date (ISO format)')
        .option('--until <date>', 'Threads updated before this date (ISO format)')
        .option('--limit <n>', 'Max threads per page (default: 50)')
        .option('--cursor <cursor>', 'Pagination cursor from a previous response')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc channel threads 12345
  tdc channel threads "general"
  tdc channel threads id:12345 --unread
  tdc channel threads 12345 --archive-filter all --since 2026-01-01
  tdc channel threads 12345 --limit 20 --json
  tdc channel threads 12345 --limit 20 --cursor <cursor-from-previous>

Notes:
  Sorted newest-first by last activity. --limit, --cursor, --since, --until,
  and --unread are applied client-side; --archive-filter is applied server-side.`,
        )
        .action(showChannelThreads)
}

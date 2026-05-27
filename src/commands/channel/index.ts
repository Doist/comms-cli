import { Command, Option } from 'commander'
import { withCaseInsensitiveChoices } from '../../lib/completion.js'
import { addChannelMembers } from './add.js'
import { createChannel } from './create.js'
import { listChannels } from './list.js'
import { listChannelMembers } from './members.js'
import { removeChannelMembers } from './remove.js'
import { setChannelMembers } from './set.js'
import { showChannelThreads } from './threads.js'
import { updateChannel } from './update.js'

export function registerChannelCommand(program: Command): void {
    const channel = program
        .command('channel')
        .alias('channels')
        .description('Channel operations (list, create, update, threads, members)')

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
        .command('create <name>')
        .description('Create a channel')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option('--description <text>', 'Channel description')
        .option('--users <refs>', 'Comma-separated user references to add (id:N, email, or name)')
        .option('--public', 'Create a public channel')
        .option('--private', 'Create a private channel')
        .option('--dry-run', 'Show what would be created without creating')
        .option('--json', 'Output created channel as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc channel create "Engineering"
  tdc channel create "Leadership Team" --private --users id:10,id:20
  tdc channel create "Product" --workspace "Doist" --description "Product discussions" --json`,
        )
        .action(createChannel)

    channel
        .command('update <channel-ref> [name]')
        .description('Update channel metadata')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option('--name <name>', 'New channel name')
        .option('--description <text>', 'New channel description')
        .option('--clear-description', 'Clear the channel description')
        .option('--public', 'Make the channel public')
        .option('--private', 'Make the channel private')
        .option('--dry-run', 'Show what would be updated without updating')
        .option('--json', 'Output updated channel as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc channel update "Engineering" "Platform Engineering"
  tdc channel update id:abc123 --description "Team discussions"
  tdc channel update "Leadership" --private --json`,
        )
        .action(updateChannel)

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

    const members = channel
        .command('members')
        .description('Channel membership operations (list, add, remove, set)')

    members
        .command('list <channel-ref>', { isDefault: true })
        .description("List a channel's members and groups fully present in the channel")
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc channel members 12345
  tdc channel members "general" --json
  tdc channel members add 12345 alice group:Design
  tdc channel members remove 12345 alice
  tdc channel members set 12345 group:Squad --apply

Notes:
  "Groups fully in channel" lists groups whose entire current membership is
  already in the channel — a hint, not a persistent link.`,
        )
        .action(listChannelMembers)

    members
        .command('add <channel-ref> [refs...]')
        .description('Add users and/or groups to a channel')
        .option('--dry-run', 'Show what would change without changing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include the full updated channel in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc channel members add 12345 alice@doist.com bob@doist.com
  tdc channel members add "general" group:Frontend
  tdc channel members add 12345 alice group:Design id:789 --json

Notes:
  Refs accept user identifiers (id:N, email, name) or "group:<ref>" to expand
  a group to its current members. Group expansion is one-shot — users added
  later to the group will not auto-join the channel.`,
        )
        .action(addChannelMembers)

    members
        .command('remove <channel-ref> [refs...]')
        .description('Remove users and/or groups from a channel')
        .option('--dry-run', 'Show what would change without changing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include the full updated channel in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc channel members remove 12345 alice@doist.com
  tdc channel members remove "general" group:Frontend

Notes:
  Refs accept user identifiers (id:N, email, name) or "group:<ref>" to expand
  a group to its current members.`,
        )
        .action(removeChannelMembers)

    members
        .command('set <channel-ref> [refs...]')
        .description('Replace channel membership with the resolved set of refs')
        .option('--apply', 'Actually mutate (otherwise dry-run)')
        .option('--include-self', 'Allow set to remove the acting user')
        .option('--dry-run', 'Force dry-run (default behaviour)')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include the full updated channel in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc channel members set 12345 group:Frontend group:Design
  tdc channel members set "general" alice bob carol --apply
  tdc channel members set 12345 group:Squad --apply --include-self

Notes:
  Dry-run by default. Pass --apply to mutate.
  Refuses to remove the acting user unless --include-self is also passed.
  Group expansion is one-shot — users added later to a referenced group will
  not auto-join the channel.`,
        )
        .action(setChannelMembers)
}

import { Command } from 'commander'
import { clearStatus } from './clear.js'
import { setStatus } from './set.js'
import { showStatus } from './show.js'

export function registerStatusCommand(program: Command): void {
    const status = program.command('status').description('Show, set or clear your status')

    status
        .command('show', { isDefault: true })
        .description('Show your current status')
        .option('--json', 'Output as JSON')
        .option('--full', 'Include all user fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc status
  tdc status --json`,
        )
        .action(showStatus)

    status
        .command('set <message>')
        .description('Set your status, replacing its message, emoji, expiration, and pause effects')
        .option('--emoji <emoji>', 'Emoji to show next to the message')
        .option(
            '--until <datetime>',
            'When the status ends: YYYY-MM-DD, YYYY-MM-DDTHH:MM or a full ISO 8601 timestamp. Local time unless it has Z or an offset',
        )
        .option('--for <duration>', 'How long the status lasts, e.g. 30m, 2h, 1d, 1h30m')
        .option(
            '--pause-notifications',
            'Hold back Comms notifications while the status is active. Comms only for now: each app has to read the status to honour it',
        )
        .option(
            '--pause-activity',
            'Pause your Todoist Karma and streaks while the status is active. Independent of --pause-notifications',
        )
        .option('--dry-run', 'Show what would be set without setting it')
        .option('--json', 'Output as JSON')
        .option('--full', 'Include all user fields in JSON output')
        .addHelpText(
            'after',
            `
The message is 1 to 80 characters. The status is shared with your Todoist account.
Setting or clearing it needs the user:write scope, so log in with tdc auth login --full-access.
--pause-notifications only affects Comms for now. Each app has to read the status and hold
its own notifications back, and Todoist does not yet. Held notifications are not sent later.
--pause-activity protects your Todoist Karma and streaks. It does not hold back notifications,
and --pause-notifications does not protect Karma, so pass both if you want both.
Omitted emoji, expiration, and pause flags clear those values. Other fields and effects are preserved.

Examples:
  tdc status set "On holiday" --emoji 🏝️ --until 2026-10-20T09:00
  tdc status set "Deep work" --emoji 🎯 --for 2h --pause-notifications
  tdc status set "On holiday" --emoji 🏝️ --until 2026-10-30 --pause-activity`,
        )
        .action(setStatus)

    status
        .command('clear')
        .description('Clear your status')
        .option('--dry-run', 'Show what would be cleared without clearing it')
        .option('--json', 'Output as JSON')
        .option('--full', 'Include all user fields in JSON output')
        .action(clearStatus)
}

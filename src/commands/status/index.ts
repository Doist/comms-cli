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
        .description('Set your status, replacing any current one')
        .option('--emoji <emoji>', 'Emoji to show next to the message')
        .option(
            '--until <datetime>',
            'When the status ends (ISO 8601; local time without an offset)',
        )
        .option('--for <duration>', 'How long the status lasts, e.g. 30m, 2h, 1d, 1h30m')
        .option('--pause-notifications', 'Hold back Comms notifications while the status is active')
        .option('--dry-run', 'Show what would be set without setting it')
        .option('--json', 'Output as JSON')
        .option('--full', 'Include all user fields in JSON output')
        .addHelpText(
            'after',
            `
The message is 1 to 80 characters. The status is shared with your Todoist account.
Notifications held back by --pause-notifications are not sent later.

Examples:
  tdc status set "On holiday" --emoji 🏝️ --until 2026-10-20T09:00
  tdc status set "Deep work" --emoji 🎯 --for 2h --pause-notifications`,
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

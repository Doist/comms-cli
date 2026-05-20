import { Command } from 'commander'
import type { MutationOptions, ViewOptions } from '../../lib/options.js'
import { clearAway } from './clear.js'
import { setAway } from './set.js'
import { showAwayStatus } from './status.js'

export function registerAwayCommand(program: Command): void {
    const away = program
        .command('away')
        .description('Manage away status')
        .option('--json', 'Output as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  cm away
  cm away --json`,
        )
        .action((options: ViewOptions) => showAwayStatus(options))

    away.command('set <type> [until]')
        .usage('<type> [until] [options]')
        .description('Set away status (type: vacation, parental, sickleave, other)')
        .option('--from <date>', 'Start date (YYYY-MM-DD, defaults to today)')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  cm away set vacation 2025-12-31
  cm away set sickleave --from 2025-06-01
  cm away set other 2025-07-01 --dry-run`,
        )
        .action(
            (
                type: string,
                until: string | undefined,
                options: ViewOptions & MutationOptions & { from?: string },
            ) => setAway(type, until, options),
        )

    away.command('clear')
        .description('Clear away status')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  cm away clear
  cm away clear --dry-run`,
        )
        .action((options: MutationOptions & ViewOptions) => clearAway(options))
}

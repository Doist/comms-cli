import type { Command } from 'commander'
import { migrateUrls } from './urls.js'

export function registerMigrateCommand(program: Command): void {
    const migrate = program.command('migrate').description('Twist→Comms migration helpers')

    migrate
        .command('urls [urls]')
        .description('Translate twist.com URLs to their Comms equivalents')
        .option('--twist-token <token>', 'Twist auth token (defaults to $TWIST_AUTH_TOKEN)')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .addHelpText(
            'after',
            `
The migration endpoint needs a Twist (not Comms) token. The recommended way to
supply it is via the Twist CLI, if installed:

Examples:
  tdc migrate urls "https://twist.com/a/1/ch/2/t/3,https://twist.com/a/1/ch/2/t/4" --twist-token "$(tw auth token view)"
  cat old-urls.txt | tdc migrate urls --twist-token "$(tw auth token view)"
  TWIST_AUTH_TOKEN=... tdc migrate urls "https://twist.com/a/1/ch/2/t/3" --json`,
        )
        .action(migrateUrls)
}

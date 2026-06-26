import type { Command } from 'commander'
import { migrateUrls } from './urls.js'

export function registerMigrateCommand(program: Command): void {
    const migrate = program.command('migrate').description('Twist→Comms migration helpers')

    migrate
        .command('urls [urls]')
        .description('Translate twist.com URLs to their Comms equivalents')
        .option('--twist-token <token>', 'Twist auth token (overrides $TWIST_AUTH_TOKEN)')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .addHelpText(
            'after',
            `
The migration endpoint needs a Twist (not Comms) token. Prefer the TWIST_AUTH_TOKEN
environment variable — a CLI flag exposes the token in process listings. If the
Twist CLI (tw) is installed, you can populate it inline:

Examples:
  TWIST_AUTH_TOKEN="$(tw auth token view)" tdc migrate urls "https://twist.com/a/1/ch/2/t/3,https://twist.com/a/1/ch/2/t/4"
  cat old-urls.txt | TWIST_AUTH_TOKEN="$(tw auth token view)" tdc migrate urls
  tdc migrate urls "https://twist.com/a/1/ch/2/t/3" --json   # token from $TWIST_AUTH_TOKEN`,
        )
        .action(migrateUrls)
}

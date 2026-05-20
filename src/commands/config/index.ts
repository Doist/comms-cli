import { Command } from 'commander'
import { listSettableKeys, setConfigValue } from './set.js'
import { viewConfig } from './view.js'

export function registerConfigCommand(program: Command): void {
    const config = program.command('config').description('Manage CLI configuration')

    config
        .command('view', { isDefault: true })
        .description('Show the current CLI configuration file')
        .option('--json', 'Output the raw config as JSON')
        .option('--show-token', 'Include the full token instead of masking it')
        .action(viewConfig)

    config
        .command('set <key> <value>')
        .description('Set a user preference in the config file')
        .addHelpText(
            'after',
            `
Settable keys:
${listSettableKeys()}

Examples:
  $ cm config set unarchive-new-threads true
  $ cm config set unarchive-new-threads false`,
        )
        .action(setConfigValue)

    config.addHelpText(
        'after',
        `
Examples:
  $ cm config view                              # pretty-printed, token masked
  $ cm config view --json                       # raw JSON, token masked
  $ cm config view --show-token                 # include the full token
  $ cm config set unarchive-new-threads true    # change a user preference`,
    )
}

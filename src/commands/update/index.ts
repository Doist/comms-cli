import { registerUpdateCommand as registerCoreUpdateCommand } from '@doist/cli-core/commands'
import type { Command } from 'commander'
import packageJson from '../../../package.json' with { type: 'json' }
import { getConfigPath } from '../../lib/config.js'
import { withSpinner } from '../../lib/spinner.js'
import { switchPackage, type UpdateFlags } from './switch-package.js'

export function registerUpdateCommand(program: Command): void {
    registerCoreUpdateCommand(program, {
        packageName: packageJson.name,
        currentVersion: packageJson.version,
        configPath: getConfigPath(),
        changelogCommandName: 'tdc changelog',
        withSpinner,
    })

    // Keep cli-core's command, flags and `update switch` subcommand, but
    // replace what `tdc update` itself does: move to `@todoist/comms-cli`.
    const update = program.commands.find((command) => command.name() === 'update')
    if (!update) {
        throw new Error('cli-core did not register the update command')
    }
    update.action(async function (this: Command) {
        // `--json` / `--ndjson` may also be given on the root program.
        const { json, ndjson } = this.optsWithGlobals<UpdateFlags>()
        await switchPackage(
            { currentVersion: packageJson.version, configPath: getConfigPath() },
            { ...this.opts<UpdateFlags>(), json, ndjson },
        )
    })
}

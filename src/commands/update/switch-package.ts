import { spawn } from 'node:child_process'
import { emitView, getErrorMessage } from '@doist/cli-core'
import {
    fetchLatestVersion,
    getConfiguredUpdateChannel,
    getInstallTag,
} from '@doist/cli-core/commands'
import chalk from 'chalk'
import type { UpdateChannel } from '../../lib/config.js'
import { CliError } from '../../lib/errors.js'
import { NEW_PACKAGE_NAME, OLD_PACKAGE_NAME } from '../../lib/package-move.js'
import { stopEarlySpinner, withSpinner } from '../../lib/spinner.js'

type PackageManager = 'npm' | 'pnpm'

export type SwitchPackageOptions = {
    currentVersion: string
    configPath: string
}

export type UpdateFlags = {
    check?: boolean
    channel?: boolean
    json?: boolean
    ndjson?: boolean
}

/**
 * The same detection cli-core's `update` uses: `npm_execpath` is only set
 * under `npm run`, so the running script and node binary paths are searched
 * too. Both contain `pnpm` for a pnpm global install.
 */
function detectPackageManager(): PackageManager {
    const haystack = [process.env.npm_execpath, process.argv[1], process.execPath]
        .filter(Boolean)
        .join(' ')
    return haystack.includes('pnpm') ? 'pnpm' : 'npm'
}

function uninstallCommand(pm: PackageManager, name: string): string[] {
    return [pm, pm === 'pnpm' ? 'remove' : 'uninstall', '-g', name]
}

function installCommand(pm: PackageManager, spec: string): string[] {
    return [pm, pm === 'pnpm' ? 'add' : 'install', '-g', spec]
}

/**
 * Run a package-manager command with its output streamed to the user.
 * Resolves with a description of the failure, or `undefined` on success.
 */
function run(argv: string[]): Promise<string | undefined> {
    const [command, ...args] = argv
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            // npm and pnpm are `.cmd` shims on Windows, which spawn() only
            // resolves through the shell. Every argument is a fixed literal or
            // one of this CLI's own package names and versions.
            shell: process.platform === 'win32',
        })
        child.on('error', (error) => resolve(getErrorMessage(error)))
        child.on('close', (code) =>
            resolve(code === 0 ? undefined : `${command} exited with code ${code ?? 1}`),
        )
    })
}

function formatChannel(channel: UpdateChannel): string {
    return channel === 'pre-release' ? chalk.magenta('pre-release') : chalk.green('stable')
}

/**
 * `tdc update` for the last `@doist/comms-cli` release: instead of updating in
 * place, it replaces this package with `@todoist/comms-cli`. Both ship the
 * `tdc` binary, so the old package has to be removed before the new one can
 * be installed. `--check`, `--json` and `--ndjson` only report the move and
 * change nothing.
 */
export async function switchPackage(options: SwitchPackageOptions, flags: UpdateFlags) {
    if (flags.check && flags.channel) {
        throw new CliError('INVALID_FLAGS', 'Specify either --check or --channel, not both.')
    }

    const view = { json: flags.json, ndjson: flags.ndjson }
    const channel = await getConfiguredUpdateChannel(options.configPath)

    if (flags.channel) {
        emitView(view, { channel }, () => [`Update channel: ${formatChannel(channel)}`])
        return
    }

    const { currentVersion } = options
    const tag = getInstallTag(channel)
    const pm = detectPackageManager()
    const uninstall = uninstallCommand(pm, OLD_PACKAGE_NAME)
    const install = installCommand(pm, `${NEW_PACKAGE_NAME}@${tag}`)
    const manualCommands = [uninstall.join(' '), install.join(' ')]
    const manualHint = `To switch by hand, run \`${manualCommands[0]}\` and then \`${manualCommands[1]}\``

    if (flags.check || view.json || view.ndjson) {
        const payload = {
            currentVersion,
            channel,
            movedTo: NEW_PACKAGE_NAME,
            ...(flags.check ? { updateAvailable: true } : { installed: false }),
            command: 'tdc update',
            manualCommands,
        }
        emitView(view, payload, () => [
            `tdc has moved to ${chalk.green(NEW_PACKAGE_NAME)} (you have ${OLD_PACKAGE_NAME} v${currentVersion}).`,
            `Run ${chalk.cyan('tdc update')} to switch, or run:`,
            ...manualCommands.map((command) => `  ${command}`),
        ])
        return
    }

    // Look the target up first, so an unreachable registry or a missing
    // dist-tag fails before anything is uninstalled.
    let latestVersion: string
    try {
        latestVersion = await withSpinner(
            { text: `Checking ${NEW_PACKAGE_NAME}@${tag}...`, color: 'blue' },
            () => fetchLatestVersion({ packageName: NEW_PACKAGE_NAME, distTag: tag }),
        )
    } catch (error) {
        throw new CliError(
            'UPDATE_CHECK_FAILED',
            `Could not look up ${NEW_PACKAGE_NAME}@${tag}: ${getErrorMessage(error)}. Nothing was changed.`,
            channel === 'pre-release'
                ? [
                      'Switch to the stable channel with `tdc update switch --stable`, then run `tdc update` again',
                      manualHint,
                  ]
                : [manualHint],
        )
    }
    // The package manager's output goes straight to the terminal, so the
    // spinner must not keep drawing over it.
    stopEarlySpinner()

    console.log(
        `tdc has moved to ${chalk.green(NEW_PACKAGE_NAME)}. Replacing ${OLD_PACKAGE_NAME} v${currentVersion} with ${NEW_PACKAGE_NAME} v${latestVersion}.`,
    )

    console.log(chalk.dim(`$ ${uninstall.join(' ')}`))
    const uninstallFailure = await run(uninstall)
    if (uninstallFailure) {
        throw new CliError(
            'UPDATE_INSTALL_FAILED',
            `Could not remove ${OLD_PACKAGE_NAME} (${uninstallFailure}).`,
            [manualHint, 'If it was a permissions error, run both commands with sudo'],
        )
    }

    console.log(chalk.dim(`$ ${install.join(' ')}`))
    const installFailure = await run(install)
    if (installFailure) {
        const restore = installCommand(pm, `${OLD_PACKAGE_NAME}@${currentVersion}`)
        console.error(
            chalk.yellow(
                `Installing ${NEW_PACKAGE_NAME} failed (${installFailure}). Reinstalling ${OLD_PACKAGE_NAME} v${currentVersion}...`,
            ),
        )
        console.log(chalk.dim(`$ ${restore.join(' ')}`))
        const restoreFailure = await run(restore)
        throw new CliError(
            'UPDATE_INSTALL_FAILED',
            restoreFailure
                ? `Could not install ${NEW_PACKAGE_NAME} (${installFailure}), and reinstalling ${OLD_PACKAGE_NAME} v${currentVersion} failed too (${restoreFailure}), so tdc may not be installed.`
                : `Could not install ${NEW_PACKAGE_NAME} (${installFailure}). ${OLD_PACKAGE_NAME} v${currentVersion} was reinstalled, so tdc still works.`,
            [
                restoreFailure ? `To switch by hand, run \`${manualCommands[1]}\`` : manualHint,
                'If it was a permissions error, run the commands with sudo',
            ],
        )
    }

    console.log(`${chalk.green('✓')} Installed ${NEW_PACKAGE_NAME} v${latestVersion}`)
    console.log('  tdc keeps working with the same config and login.')
}

import chalk from 'chalk'
import packageJson from '../../package.json' with { type: 'json' }

/**
 * The CLI is now published as `@todoist/comms-cli`, with the same `tdc`
 * binary, config file and login. `@doist/comms-cli` gets no further releases,
 * and its `tdc update` would only ever ask the registry about the old name, so
 * this package's job is to tell people about the move and switch them over.
 */
export const OLD_PACKAGE_NAME = packageJson.name
export const NEW_PACKAGE_NAME = '@todoist/comms-cli'

/**
 * Commands that never print the notice: `update` explains the move itself,
 * and `completion-server` runs inside shell tab completion, where anything on
 * stderr lands in the middle of the user's prompt.
 */
const COMMANDS_WITHOUT_NOTICE = new Set(['update', 'completion-server'])

/**
 * Write the one-line "tdc has moved" notice to stderr. Only when stderr is a
 * terminal, so pipes, scripts, agents and `--json` / `--ndjson` consumers never
 * see it.
 */
export function writeMovedNotice(command: string | undefined): void {
    if (!process.stderr.isTTY) return
    if (command !== undefined && COMMANDS_WITHOUT_NOTICE.has(command)) return
    process.stderr.write(
        `${chalk.yellow(`tdc has moved to ${NEW_PACKAGE_NAME}. Run "tdc update" to switch.`)}\n`,
    )
}

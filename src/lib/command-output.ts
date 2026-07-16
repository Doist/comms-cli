import type { Command } from 'commander'
import { stopEarlySpinner } from './spinner.js'

export function configureCommandOutput(command: Command): Command {
    return command
        .configureOutput({
            writeOut: (str) => {
                stopEarlySpinner()
                process.stdout.write(str)
            },
            writeErr: (str) => {
                stopEarlySpinner()
                process.stderr.write(str)
            },
        })
        .exitOverride()
}

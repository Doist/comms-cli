import { attachLoginCommand } from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { Command } from 'commander'
import { renderError, renderSuccess } from '../../lib/auth-pages.js'
import {
    createCommsAuthProvider,
    getScopes,
    type CommsTokenStore,
} from '../../lib/auth-provider.js'
import { logTokenStorageResult } from './helpers.js'

const PREFERRED_CALLBACK_PORT = 8766

export function attachCommsLoginCommand(parent: Command, store: CommsTokenStore): Command {
    const provider = createCommsAuthProvider()

    return attachLoginCommand(parent, {
        provider,
        store,
        preferredPort: PREFERRED_CALLBACK_PORT,
        resolveScopes: ({ readOnly }) => getScopes(readOnly),
        renderSuccess,
        renderError,
        onSuccess({ view, account }) {
            const isMachineOutput = view.json || view.ndjson
            if (!isMachineOutput) {
                console.log(chalk.green('✓'), 'OAuth authentication successful!')
                console.log(chalk.dim(`Logged in as ${account.label}`))
            }
            const result = store.getLastStorageResult()
            if (result) {
                logTokenStorageResult(
                    result,
                    'Token stored securely in the system credential manager',
                    isMachineOutput,
                )
            }
        },
    }).description('Authenticate using OAuth (opens browser)')
}

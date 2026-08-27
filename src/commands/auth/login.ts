import { attachLoginCommand } from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { Command } from 'commander'
import { renderError, renderSuccess } from '../../lib/auth-pages.js'
import {
    createCommsAuthProvider,
    type CommsCredentialStore,
    createCommsTokenStore,
    getScopes,
    parseCredentialStore,
} from '../../lib/auth-provider.js'
import { CliError } from '../../lib/errors.js'
import { logTokenStorageResult, resetCurrentWorkspaceAfterLogin } from './helpers.js'

const PREFERRED_CALLBACK_PORT = 8766

export function attachCommsLoginCommand(parent: Command): Command {
    const provider = createCommsAuthProvider()
    let credentialStore: CommsCredentialStore = 'fallback'
    const store = createCommsTokenStore({ credentialStore: () => credentialStore })

    return attachLoginCommand(parent, {
        provider,
        store,
        preferredPort: PREFERRED_CALLBACK_PORT,
        resolveScopes: ({ readOnly, flags }) => {
            if (readOnly && flags.fullAccess === true) {
                throw new CliError(
                    'CONFLICTING_OPTIONS',
                    'Choose either --read-only or --full-access, not both.',
                )
            }
            return getScopes({ readOnly, fullAccess: flags.fullAccess === true })
        },
        renderSuccess,
        renderError,
        async onSuccess({ view, account }) {
            await resetCurrentWorkspaceAfterLogin(store, account)
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
    })
        .description('Authenticate using OAuth (opens browser)')
        .option('--full-access', 'Request delete and workspace/user write scopes')
        .option(
            '--credential-store <store>',
            'Credential storage: fallback (default), system, or plaintext',
            (value: string) => {
                credentialStore = parseCredentialStore(value)
                return credentialStore
            },
            'fallback',
        )
}

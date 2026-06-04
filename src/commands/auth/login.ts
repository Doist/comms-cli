import { attachLoginCommand } from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createWrappedCommsClient } from '../../lib/api.js'
import { renderError, renderSuccess } from '../../lib/auth-pages.js'
import {
    type CommsAccount,
    createCommsAuthProvider,
    getScopes,
    type CommsTokenStore,
} from '../../lib/auth-provider.js'
import { getConfig, updateConfig } from '../../lib/config.js'
import { CliError } from '../../lib/errors.js'
import { logTokenStorageResult } from './helpers.js'

const PREFERRED_CALLBACK_PORT = 8766

async function resetCurrentWorkspaceAfterLogin(
    store: CommsTokenStore,
    account: CommsAccount,
): Promise<void> {
    let currentWorkspace: number | undefined
    try {
        currentWorkspace = (await getConfig()).currentWorkspace
    } catch {
        // Treat unreadable config as having no reliable workspace preference.
    }

    let token: string | undefined
    try {
        token = (await store.active(account.id))?.token
    } catch {
        await clearCurrentWorkspaceAfterLogin(currentWorkspace)
        return
    }
    if (!token) {
        await clearCurrentWorkspaceAfterLogin(currentWorkspace)
        return
    }

    try {
        const baseUrl = process.env.COMMS_BASE_URL ?? account.authResource
        const client = createWrappedCommsClient(token, { baseUrl })
        const workspaces = await client.workspaces.getWorkspaces()
        if (
            currentWorkspace !== undefined &&
            workspaces.some((workspace) => workspace.id === currentWorkspace)
        ) {
            return
        }
        if (workspaces.length === 1) {
            await updateCurrentWorkspaceAfterLogin(workspaces[0].id)
            return
        }
        await clearCurrentWorkspaceAfterLogin(currentWorkspace)
    } catch {
        await clearCurrentWorkspaceAfterLogin(currentWorkspace)
    }
}

async function clearCurrentWorkspaceAfterLogin(
    currentWorkspace: number | undefined,
): Promise<void> {
    if (currentWorkspace !== undefined) {
        await updateCurrentWorkspaceAfterLogin(undefined)
    }
}

async function updateCurrentWorkspaceAfterLogin(
    currentWorkspace: number | undefined,
): Promise<void> {
    try {
        await updateConfig({ currentWorkspace })
    } catch {
        // Login should not fail just because workspace preselection failed.
    }
}

export function attachCommsLoginCommand(parent: Command, store: CommsTokenStore): Command {
    const provider = createCommsAuthProvider()

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
}

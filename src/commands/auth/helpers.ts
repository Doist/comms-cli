import type { TokenStorageResult } from '@doist/cli-core/auth'
import chalk from 'chalk'
import { createWrappedCommsClient } from '../../lib/api.js'
import type { CommsAccount, CommsTokenStore } from '../../lib/auth-provider.js'
import { getConfig, updateConfig } from '../../lib/config.js'

/**
 * Surface a `TokenStorageResult` from a save/clear operation: the
 * human-readable confirmation goes to stdout, any keyring-fallback warning
 * goes to stderr. Pass `isMachineOutput: true` when the command is in
 * `--json` / `--ndjson` mode so the stdout confirmation is suppressed and
 * the warning still reaches the operator on stderr.
 */
export function logTokenStorageResult(
    result: TokenStorageResult,
    secureStoreMessage: string,
    isMachineOutput = false,
): void {
    if (!isMachineOutput && result.storage === 'secure-store') {
        console.log(chalk.dim(secureStoreMessage))
    }
    if (result.warning) {
        console.error(chalk.yellow('Warning:'), result.warning)
    }
}

/**
 * Surface the result of a token-store `clear()` (stashed on the adapter via
 * `getLastClearResult`, since cli-core's `clear` can't return it directly).
 * Shared by `auth logout`'s `onCleared` and `account remove`'s `onRemoved` so
 * the confirmation/warning UX can't drift between the two.
 */
export function logStoredTokenRemoval(
    store: { getLastClearResult(): TokenStorageResult | undefined },
    view: { json?: boolean; ndjson?: boolean },
): void {
    const result = store.getLastClearResult()
    if (!result) return
    logTokenStorageResult(
        result,
        'Stored token removed from the system credential manager',
        view.json || view.ndjson,
    )
}

export async function resetCurrentWorkspaceAfterLogin(
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
        const client = createWrappedCommsClient(token, { baseUrl: account.authResource })
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

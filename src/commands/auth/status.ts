import { attachStatusCommand } from '@doist/cli-core/auth'
import { CommsRequestError, type User } from '@doist/comms-sdk'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createWrappedCommsClient } from '../../lib/api.js'
import type { CommsAccount, CommsTokenStore } from '../../lib/auth-provider.js'
import {
    type AuthMetadata,
    getApiTokenSnapshot,
    NoTokenError,
    TOKEN_ENV_VAR,
} from '../../lib/auth.js'
import type { AuthMode } from '../../lib/config.js'
import { CliError } from '../../lib/errors.js'

type StatusData = {
    user: User
    metadata: AuthMetadata
}

function formatAuthMode(authMode: AuthMode, authScope?: string): string {
    if (authMode === 'read-only') {
        return `read-only (scope: ${authScope ?? 'unknown'})`
    }
    if (authMode === 'read-write') {
        return 'read-write'
    }
    return 'unknown (manual token or env var; assuming write access)'
}

/**
 * Fetch the live session user via the selected account's resource. 401
 * translation lives here so both refreshed OAuth tokens and manual tokens emit
 * the same `NO_TOKEN` envelope when Comms rejects them.
 */
function metadataFromAccount(account: CommsAccount): AuthMetadata {
    const authUserId = Number(account.id)
    return {
        authMode: account.authMode,
        ...(account.authResource ? { authResource: account.authResource } : {}),
        authScope: account.authScope || undefined,
        authUserId: Number.isFinite(authUserId) && authUserId > 0 ? authUserId : undefined,
        authUserName: account.label || undefined,
        source: account.id || !process.env[TOKEN_ENV_VAR] ? 'config' : 'env',
    }
}

async function gatherStatusData(token: string, account: CommsAccount): Promise<StatusData> {
    try {
        const user = await createWrappedCommsClient(token, {
            baseUrl: account.authResource,
        }).users.getSessionUser()
        return { user, metadata: metadataFromAccount(account) }
    } catch (error) {
        if (error instanceof CommsRequestError && error.httpStatusCode === 401) {
            throw new CliError('NO_TOKEN', 'Not authenticated (token expired or invalid)', [
                'Run `tdc auth login` to re-authenticate',
            ])
        }
        throw error
    }
}

function buildStatusText({ user, metadata }: StatusData): readonly string[] {
    const modeLabel = formatAuthMode(metadata.authMode, metadata.authScope)
    return [
        `${chalk.green('✓')} Authenticated`,
        `  Email: ${user.email}`,
        `  Name:  ${user.fullName}`,
        `  Mode:  ${modeLabel}`,
    ]
}

function buildStatusJson({ user, metadata }: StatusData): Record<string, unknown> {
    return {
        id: user.id,
        email: user.email,
        name: user.fullName,
        authMode: metadata.authMode,
        authScope: metadata.authScope,
        source: metadata.source,
    }
}

/**
 * Attach `tdc auth status` via cli-core's generic `attachStatusCommand`.
 *
 * cli-core reads the selected account first. `fetchLive` then refreshes OAuth
 * accounts through the same auth shim as normal API calls before validating
 * the token against Comms. `onNotAuthenticated` only fires when nothing is
 * stored — it throws `NoTokenError` so the standard CliError envelope reaches
 * the operator unchanged.
 */
export function attachCommsStatusCommand(auth: Command, store: CommsTokenStore): Command {
    let data: StatusData | null = null

    return attachStatusCommand<CommsAccount>(auth, {
        store,
        description: 'Show current authentication status',
        fetchLive: async ({ account, token }) => {
            const snapshot = account.id ? await getApiTokenSnapshot(account.id) : { account, token }
            data = await gatherStatusData(snapshot.token, snapshot.account)
            return {
                id: String(data.user.id),
                label: data.user.fullName,
                authMode: data.metadata.authMode,
                authScope: data.metadata.authScope ?? '',
            }
        },
        renderText: () => {
            if (!data) {
                throw new CliError('INTERNAL_ERROR', 'status renderText called before fetchLive')
            }
            return buildStatusText(data)
        },
        renderJson: () => {
            if (!data) {
                throw new CliError('INTERNAL_ERROR', 'status renderJson called before fetchLive')
            }
            return buildStatusJson(data)
        },
        onNotAuthenticated: () => {
            throw new NoTokenError()
        },
    })
}

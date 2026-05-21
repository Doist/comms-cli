import { attachStatusCommand } from '@doist/cli-core/auth'
import { CommsRequestError, type User } from '@doist/comms-sdk'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createWrappedCommsClient } from '../../lib/api.js'
import type { CommsAccount, CommsTokenStore } from '../../lib/auth-provider.js'
import { type AuthMetadata, getAuthMetadata, NoTokenError } from '../../lib/auth.js'
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
 * Fetch the live session user (via the snapshot token) and the local auth
 * metadata concurrently — the API call dominates and the metadata read is
 * independent. 401-translation lives here so both the snapshot path and any
 * future callers emit the same `NO_TOKEN` envelope when the token is
 * rejected by the API.
 */
async function gatherStatusData(token: string): Promise<StatusData> {
    try {
        const [user, metadata] = await Promise.all([
            createWrappedCommsClient(token).users.getSessionUser(),
            getAuthMetadata(),
        ])
        return { user, metadata }
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
 * `CommsTokenStore.active()` returns a snapshot whenever a token resolves
 * (per the adapter's documented contract — see `auth-provider.ts`), so
 * `fetchLive` covers every token-present path: secure-store, plaintext
 * config fallback, env-token mode, and manual `tdc auth token`. The
 * snapshot's token is reused inside `gatherStatusData` so credentials are
 * read once per invocation. `onNotAuthenticated` only fires when nothing
 * is stored — it throws `NoTokenError` so the standard CliError envelope
 * reaches the operator unchanged.
 */
export function attachCommsStatusCommand(auth: Command, store: CommsTokenStore): Command {
    let data: StatusData | null = null

    return attachStatusCommand<CommsAccount>(auth, {
        store,
        description: 'Show current authentication status',
        fetchLive: async ({ token }) => {
            data = await gatherStatusData(token)
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

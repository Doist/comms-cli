import type { Channel } from '@doist/comms-sdk'
import { getCommsClient, getCurrentWorkspaceId } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import {
    getDirectChannelId,
    parseRef,
    resolveChannelRef,
    resolveWorkspaceRef,
} from '../../lib/refs.js'
import { validateNonEmptyName } from '../../lib/validation.js'

export function validateChannelName(name: string): void {
    validateNonEmptyName(name, 'Channel')

    if (parseRef(name).type !== 'name') {
        throw new CliError('INVALID_NAME', 'Channel name cannot look like an ID or URL.', [
            'Use a name with letters and no ID-like pattern, such as "Engineering Team".',
        ])
    }
}

export function resolveVisibilityOption(options: {
    public?: boolean
    private?: boolean
}): boolean | undefined {
    if (options.public && options.private) {
        throw new CliError('CONFLICTING_OPTIONS', 'Use either --public or --private, not both.')
    }

    if (options.public) return true
    if (options.private) return false
    return undefined
}

export async function resolveChannelWorkspaceId(workspaceRef: string | undefined): Promise<number> {
    if (workspaceRef) {
        return (await resolveWorkspaceRef(workspaceRef)).id
    }

    return getCurrentWorkspaceId()
}

/**
 * Resolve a channel for a mutation. Direct refs (`id:` or URL) are fetched by
 * ID via `getChannel`, which is workspace-agnostic — so a channel in another
 * workspace resolves without a `--workspace` flag. Name refs still need a
 * workspace to disambiguate. An explicit `--workspace` forces the name path.
 */
export async function resolveChannelByRef(
    ref: string,
    workspaceRef: string | undefined,
): Promise<Channel> {
    if (!workspaceRef) {
        const directId = getDirectChannelId(ref)
        if (directId) {
            const client = await getCommsClient()
            return client.channels.getChannel(directId)
        }
    }

    const workspaceId = await resolveChannelWorkspaceId(workspaceRef)
    return resolveChannelRef(ref, workspaceId)
}

/** Where the previous page of `channel threads` stopped. */
export type ThreadsCursor = {
    /** `lastUpdated` of the last thread shown, in milliseconds. */
    before: number
    /** IDs of the threads already shown from that same moment, which the next page skips. */
    shown: string[]
}

export function encodeCursor(cursor: ThreadsCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeCursor(cursor: string | undefined): ThreadsCursor | undefined {
    if (!cursor) return undefined

    let parsed: unknown
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
        throw new CliError('INVALID_CURSOR', `Invalid cursor: ${cursor}`)
    }

    const { before, shown } = (parsed ?? {}) as { before?: unknown; shown?: unknown }
    if (
        typeof before !== 'number' ||
        !Number.isFinite(before) ||
        before < 0 ||
        !Array.isArray(shown) ||
        !shown.every((id) => typeof id === 'string')
    ) {
        throw new CliError('INVALID_CURSOR', `Invalid cursor: ${cursor}`)
    }

    return { before, shown }
}

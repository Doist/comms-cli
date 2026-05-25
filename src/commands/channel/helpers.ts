import { getCurrentWorkspaceId } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { parseRef, resolveWorkspaceRef } from '../../lib/refs.js'
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

export function encodeCursor(offset: number): string {
    return Buffer.from(JSON.stringify({ offset })).toString('base64url')
}

export function decodeCursor(cursor: string | undefined): number {
    if (!cursor) return 0

    let parsed: unknown
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
        throw new CliError('INVALID_CURSOR', `Invalid cursor: ${cursor}`)
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as { offset?: unknown }).offset !== 'number' ||
        !Number.isFinite((parsed as { offset: number }).offset) ||
        (parsed as { offset: number }).offset < 0
    ) {
        throw new CliError('INVALID_CURSOR', `Invalid cursor: ${cursor}`)
    }

    return (parsed as { offset: number }).offset
}

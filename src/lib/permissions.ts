import { type AuthMetadata, getAuthMetadata } from './auth.js'
import { CliError } from './errors.js'
import { hasScope } from './scopes.js'

export const READ_ONLY_ERROR_MESSAGE =
    'This CLI is authenticated in read-only mode. Re-run `tdc auth login` without --read-only to enable write operations.'

/**
 * Known read-only API method paths. Any method not in this set is assumed to be mutating.
 * This is a safe-by-default approach: new API methods are blocked until explicitly allowed.
 */
const KNOWN_SAFE_API_METHODS = new Set([
    'users.getSessionUser',
    'workspaces.getWorkspaces',
    'workspaces.getPublicChannels',
    'workspaceUsers.getWorkspaceUsers',
    'workspaceUsers.getUserById',
    'threads.getThread',
    'threads.getUnread',
    'comments.getComment',
    'comments.getComments',
    'channels.getChannel',
    'channels.getChannels',
    'conversations.getConversations',
    'conversations.getConversation',
    'conversations.getUnread',
    'conversationMessages.getMessage',
    'conversationMessages.getMessages',
    'inbox.getInbox',
    'groups.getGroups',
    'groups.getGroup',
    'batch',
])

/**
 * OAuth scopes Comms requires for API methods whose scope is *not* covered by
 * the default write grant. `workspaces:write` ships only with
 * `tdc auth login --full-access`, so without this table a default login fails
 * with an opaque server round-trip instead of an immediate, fixable error.
 *
 * Channel writes (`comms:channels:write` / `:delete`) are deliberately absent:
 * they already surface a clean 403 "Insufficient scope" from Comms, which
 * `wrapResult` turns into the same guidance.
 */
const API_METHOD_SCOPES: Record<string, string> = {
    'groups.createGroup': 'workspaces:write',
    'groups.updateGroup': 'workspaces:write',
    'groups.deleteGroup': 'workspaces:write',
    'groups.addUsers': 'workspaces:write',
    'groups.removeUsers': 'workspaces:write',
}

export function isMutatingMethod(methodPath: string): boolean {
    return !KNOWN_SAFE_API_METHODS.has(methodPath)
}

/** The scope `methodPath` needs beyond the default write grant, if any. */
export function getRequiredScope(methodPath: string): string | undefined {
    return API_METHOD_SCOPES[methodPath]
}

export async function ensureWriteAllowed(preloaded?: AuthMetadata): Promise<void> {
    const metadata = preloaded ?? (await getAuthMetadata())
    if (metadata.authMode === 'read-only') {
        throw new CliError('READ_ONLY', READ_ONLY_ERROR_MESSAGE, [
            'Re-run: tdc auth login (without --read-only)',
        ])
    }
}

/**
 * Fail fast when the stored grant is missing a scope the method needs.
 *
 * Fails *open* whenever the granted scope is unknown — `COMMS_API_TOKEN` and
 * manually-saved tokens carry no scope metadata, and may be session tokens,
 * which bypass Comms' scope enforcement entirely. Blocking those would break
 * working setups to guess at an error the server is better placed to raise.
 */
export async function ensureScopeAllowed(
    methodPath: string,
    preloaded?: AuthMetadata,
): Promise<void> {
    const requiredScope = getRequiredScope(methodPath)
    // Bail before touching auth metadata: most methods declare no extra scope.
    if (!requiredScope) return

    const metadata = preloaded ?? (await getAuthMetadata())
    const grantedScope = metadata.authScope
    if (!grantedScope) return

    if (!hasScope(grantedScope, requiredScope)) {
        throw new CliError(
            'INSUFFICIENT_SCOPE',
            `This action requires the \`${requiredScope}\` scope, which your token does not have.`,
            [
                'Re-run: tdc auth login --full-access',
                'Check the granted scopes with: tdc auth status',
            ],
        )
    }
}

/**
 * Single guard for a mutating call: one `getAuthMetadata()` read shared by both
 * checks, since it hits the config file on every invocation and is uncached.
 */
export async function ensureMutationAllowed(methodPath: string): Promise<void> {
    const metadata = await getAuthMetadata()
    await ensureWriteAllowed(metadata)
    await ensureScopeAllowed(methodPath, metadata)
}

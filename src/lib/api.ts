import {
    CommsApi,
    type Group,
    type User,
    type Workspace,
    type WorkspaceUser,
} from '@doist/comms-sdk'
import { getApiTokenSnapshot } from './auth.js'
import { getConfig, updateConfig } from './config.js'
import { CliError, isForbidden, isInsufficientScope, isInvalidToken } from './errors.js'
import { ensureScopeAllowed, ensureWriteAllowed, isMutatingMethod } from './permissions.js'
import { getProgressTracker } from './progress.js'
import { withSpinner } from './spinner.js'

// Mapping of API method paths to user-friendly spinner messages
const API_SPINNER_MESSAGES: Record<string, { text: string; color?: 'blue' | 'green' | 'yellow' }> =
    {
        // User operations
        'users.getSessionUser': { text: 'Checking authentication...', color: 'blue' },

        'users.update': { text: 'Updating user...', color: 'yellow' },

        // Workspace operations
        'workspaces.getWorkspaces': { text: 'Loading workspaces...', color: 'blue' },
        'workspaces.getDefaultWorkspace': { text: 'Loading default workspace...', color: 'blue' },
        'workspaces.getPublicChannels': { text: 'Loading public channels...', color: 'blue' },
        'workspaceUsers.getWorkspaceUsers': { text: 'Loading workspace users...', color: 'blue' },
        'workspaceUsers.getUserById': { text: 'Loading user details...', color: 'blue' },

        // Thread operations
        'threads.getThread': { text: 'Loading thread...', color: 'blue' },
        'threads.getThreads': { text: 'Loading threads...', color: 'blue' },
        'threads.getUnread': { text: 'Loading unread threads...', color: 'blue' },
        'threads.createThread': { text: 'Creating thread...', color: 'green' },
        'threads.closeThread': { text: 'Closing thread...', color: 'yellow' },
        'threads.reopenThread': { text: 'Reopening thread...', color: 'yellow' },
        'threads.updateThread': { text: 'Updating thread...', color: 'yellow' },
        'threads.markRead': { text: 'Marking thread read...', color: 'yellow' },
        'threads.muteThread': { text: 'Muting thread...', color: 'yellow' },
        'threads.unmuteThread': { text: 'Unmuting thread...', color: 'yellow' },
        'threads.deleteThread': { text: 'Deleting thread...', color: 'yellow' },

        // Comment operations
        'comments.getComment': { text: 'Loading comment...', color: 'blue' },
        'comments.getComments': { text: 'Loading comments...', color: 'blue' },
        'comments.createComment': { text: 'Creating comment...', color: 'green' },
        'comments.updateComment': { text: 'Updating comment...', color: 'yellow' },
        'comments.deleteComment': { text: 'Deleting comment...', color: 'yellow' },

        // Channel operations
        'channels.getChannel': { text: 'Loading channel...', color: 'blue' },
        'channels.getChannels': { text: 'Loading channels...', color: 'blue' },
        'channels.createChannel': { text: 'Creating channel...', color: 'green' },
        'channels.updateChannel': { text: 'Updating channel...', color: 'yellow' },
        'channels.deleteChannel': { text: 'Deleting channel...', color: 'yellow' },
        'channels.archiveChannel': { text: 'Archiving channel...', color: 'yellow' },
        'channels.unarchiveChannel': { text: 'Unarchiving channel...', color: 'yellow' },
        'channels.addUsers': { text: 'Adding users to channel...', color: 'green' },
        'channels.removeUsers': { text: 'Removing users from channel...', color: 'yellow' },

        // Conversation operations
        'conversations.getConversations': { text: 'Loading conversations...', color: 'blue' },
        'conversations.getConversation': { text: 'Loading conversation...', color: 'blue' },
        'conversations.getUnread': { text: 'Loading unread conversations...', color: 'blue' },
        'conversations.getOrCreateConversation': {
            text: 'Opening conversation...',
            color: 'green',
        },
        'conversations.archiveConversation': { text: 'Archiving conversation...', color: 'yellow' },
        'conversations.unarchiveConversation': {
            text: 'Unarchiving conversation...',
            color: 'yellow',
        },
        'conversations.muteConversation': { text: 'Muting conversation...', color: 'yellow' },
        'conversations.unmuteConversation': {
            text: 'Unmuting conversation...',
            color: 'yellow',
        },

        // Conversation message operations
        'conversationMessages.getMessage': { text: 'Loading message...', color: 'blue' },
        'conversationMessages.getMessages': { text: 'Loading messages...', color: 'blue' },
        'conversationMessages.createMessage': { text: 'Sending message...', color: 'green' },
        'conversationMessages.updateMessage': { text: 'Updating message...', color: 'yellow' },
        'conversationMessages.deleteMessage': { text: 'Deleting message...', color: 'yellow' },

        // Group operations
        'groups.getGroups': { text: 'Loading groups...', color: 'blue' },
        'groups.getGroup': { text: 'Loading group...', color: 'blue' },
        'groups.createGroup': { text: 'Creating group...', color: 'green' },
        'groups.updateGroup': { text: 'Updating group...', color: 'yellow' },
        'groups.deleteGroup': { text: 'Deleting group...', color: 'yellow' },
        'groups.addUsers': { text: 'Adding users to group...', color: 'green' },
        'groups.removeUsers': { text: 'Removing users from group...', color: 'yellow' },

        // Inbox operations
        'inbox.getInbox': { text: 'Loading inbox...', color: 'blue' },
        'inbox.archiveThread': { text: 'Archiving thread...', color: 'yellow' },
        'inbox.unarchiveThread': { text: 'Unarchiving thread...', color: 'yellow' },

        // Attachment operations
        'attachments.upload': { text: 'Uploading file...', color: 'blue' },
    }

function createSpinnerWrappedApi(api: CommsApi): CommsApi {
    return new Proxy(api, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver)

            // If this is a nested object (like workspaces, users, etc.), wrap it too
            if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                typeof property === 'string'
            ) {
                return createNestedSpinnerProxy(value, property)
            }

            return value
        },
    })
}

function createNestedSpinnerProxy<T extends object>(obj: T, basePath: string): T {
    return new Proxy(obj, {
        get(target, property, receiver) {
            const originalMethod = Reflect.get(target, property, receiver)

            if (typeof originalMethod !== 'function' || typeof property !== 'string') {
                return originalMethod
            }

            const fullPath = `${basePath}.${property}`
            const spinnerConfig = API_SPINNER_MESSAGES[fullPath]
            const shouldCheckPermissions = isMutatingMethod(fullPath)

            if (!spinnerConfig && !shouldCheckPermissions) {
                return originalMethod
            }

            return <T extends unknown[]>(...args: T) => {
                const progressTracker = getProgressTracker()

                // Extract cursor from args for paginated methods
                let cursor: string | null = null
                if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
                    const options = args[0] as Record<string, unknown>
                    if ('cursor' in options && typeof options.cursor === 'string') {
                        cursor = options.cursor
                    }
                }

                // Emit progress event for API call start
                if (progressTracker.isEnabled()) {
                    progressTracker.emitApiCall(property, cursor)
                }

                // For mutating methods, check permissions before calling the API
                if (shouldCheckPermissions) {
                    return ensureWriteAllowed()
                        .then(() => ensureScopeAllowed(fullPath))
                        .then(() => {
                            const result = originalMethod.apply(target, args)
                            return wrapResult(result, progressTracker, spinnerConfig)
                        })
                }

                const result = originalMethod.apply(target, args)
                return wrapResult(result, progressTracker, spinnerConfig)
            }
        },
    })
}

function wrapResult(
    result: unknown,
    progressTracker: ReturnType<typeof getProgressTracker>,
    spinnerConfig: (typeof API_SPINNER_MESSAGES)[string] | undefined,
): unknown {
    // If the method returns a non-thenable, return as-is.
    if (!result || typeof (result as { then?: unknown }).then !== 'function') {
        return result
    }

    const wrappedPromise = (result as Promise<unknown>)
        .then((response: unknown) => {
            if (progressTracker.isEnabled()) {
                analyzeAndEmitApiResponse(progressTracker, response)
            }
            return response
        })
        .catch((error: Error) => {
            if (progressTracker.isEnabled()) {
                progressTracker.emitError(error.name || 'API_ERROR', error.message)
            }
            if (isInsufficientScope(error)) {
                throw new CliError(
                    'INSUFFICIENT_SCOPE',
                    'This action requires permissions your current token does not have.',
                    [
                        'Run `tdc auth login` to re-authenticate with standard write scopes',
                        'Use `tdc auth login --full-access` when the action deletes content or manages channels/workspaces',
                    ],
                )
            }
            if (isForbidden(error)) {
                throw new CliError('FORBIDDEN', 'Comms refused this action: 403 Forbidden.', [
                    'You may not have permission for this action',
                    'Contact your workspace admin, or re-authenticate with `tdc auth login` if your token looks wrong',
                ])
            }
            if (isInvalidToken(error)) {
                throw new CliError('INVALID_TOKEN', 'Comms rejected the token: 401.', [
                    'Re-authenticate with `tdc auth login`, then check `tdc auth status`',
                    'Group and workspace writes need `tdc auth login --full-access`',
                ])
            }
            throw error
        })

    if (spinnerConfig) {
        return withSpinner(spinnerConfig, () => wrappedPromise)
    }
    return wrappedPromise
}

function analyzeAndEmitApiResponse(
    progressTracker: ReturnType<typeof getProgressTracker>,
    response: unknown,
): void {
    // For paginated responses, extract metadata
    if (response && typeof response === 'object' && response !== null) {
        const resp = response as Record<string, unknown>

        // Check if it's a paginated response with results array
        if ('results' in resp && Array.isArray(resp.results)) {
            progressTracker.emitApiResponse(
                resp.results.length,
                Boolean(resp.nextCursor),
                typeof resp.nextCursor === 'string' ? resp.nextCursor : null,
            )
            return
        }

        // For array responses (legacy or simple lists)
        if (Array.isArray(response)) {
            progressTracker.emitApiResponse(response.length, false, null)
            return
        }
    }

    // For other responses, emit minimal info
    progressTracker.emitApiResponse(1, false, null)
}

let apiClient: CommsApi | null = null

export function clearApiClientCache(): void {
    apiClient = null
}

export function createWrappedCommsClient(
    token: string,
    options: { baseUrl?: string } = {},
): CommsApi {
    const baseUrl = process.env.COMMS_BASE_URL ?? options.baseUrl
    const rawApi = new CommsApi(token, baseUrl ? { baseUrl } : undefined)
    return createSpinnerWrappedApi(rawApi)
}

export async function getCommsClient(): Promise<CommsApi> {
    if (!apiClient) {
        const { token, account } = await getApiTokenSnapshot()
        apiClient = createWrappedCommsClient(token, { baseUrl: account.authResource })
    }
    return apiClient
}

let workspaceCache: Workspace[] | null = null
let sessionUserCache: User | null = null

export async function fetchWorkspaces(): Promise<Workspace[]> {
    if (workspaceCache) {
        return workspaceCache
    }
    const client = await getCommsClient()
    workspaceCache = await client.workspaces.getWorkspaces()
    return workspaceCache
}

export function clearWorkspaceCache(): void {
    workspaceCache = null
}

export async function getCurrentWorkspaceId(flagValue?: number): Promise<number> {
    if (flagValue) {
        return flagValue
    }

    const config = await getConfig()
    if (config.currentWorkspace) {
        return config.currentWorkspace
    }

    const client = await getCommsClient()
    try {
        const defaultWorkspace = await client.workspaces.getDefaultWorkspace()
        await updateConfig({ currentWorkspace: defaultWorkspace.id })
        return defaultWorkspace.id
    } catch {
        // Fall back to the first workspace if the user has no preferred default.
    }

    const workspaces = await fetchWorkspaces()
    if (workspaces.length === 0) {
        throw new CliError('NOT_FOUND', 'No workspaces found for this user', [
            'Ensure your account has been added to a workspace',
        ])
    }

    const defaultWorkspace = workspaces[0]
    await updateConfig({ currentWorkspace: defaultWorkspace.id })
    return defaultWorkspace.id
}

export async function getSessionUser(): Promise<User> {
    if (sessionUserCache) {
        return sessionUserCache
    }
    const client = await getCommsClient()
    sessionUserCache = await client.users.getSessionUser()
    return sessionUserCache
}

const workspaceUserCache = new Map<string, WorkspaceUser[]>()

function workspaceUserCacheKey(workspaceId: number, includeRemoved: boolean | undefined): string {
    return `${workspaceId}:${includeRemoved ? 'all' : 'active'}`
}

async function loadWorkspaceUsers(
    workspaceId: number,
    includeRemoved: boolean | undefined,
): Promise<WorkspaceUser[]> {
    const key = workspaceUserCacheKey(workspaceId, includeRemoved)
    const cached = workspaceUserCache.get(key)
    if (cached) return cached
    const client = await getCommsClient()
    const users = await client.workspaceUsers.getWorkspaceUsers({ workspaceId, includeRemoved })
    workspaceUserCache.set(key, users)
    return users
}

export async function getWorkspaceUsers(
    workspaceId: number,
    options: { includeRemoved?: boolean } = {},
): Promise<WorkspaceUser[]> {
    return loadWorkspaceUsers(workspaceId, options.includeRemoved)
}

export function clearWorkspaceUserCache(): void {
    workspaceUserCache.clear()
}

/**
 * Returns a `userId → fullName` map for the workspace. Missing users (deleted,
 * external) are absent; callers should fall back (e.g. `?? user:${id}`).
 *
 * Pass `client` to reuse an already-resolved client (so test mocks of
 * `getCommsClient` from the calling module apply transparently).
 */
export async function buildUserNameMap(
    workspaceId: number,
    client?: CommsApi,
): Promise<Map<number, string>> {
    // Historical messages can reference users who have since been removed;
    // those messages should still render the author's name rather than fall
    // back to `user:123`. So this map always pulls the full roster.
    const key = workspaceUserCacheKey(workspaceId, true)
    const cached = workspaceUserCache.get(key)
    let users: WorkspaceUser[]
    if (cached) {
        users = cached
    } else {
        const api = client ?? (await getCommsClient())
        users = await api.workspaceUsers.getWorkspaceUsers({
            workspaceId,
            includeRemoved: true,
        })
        workspaceUserCache.set(key, users)
    }
    return new Map(users.map((u) => [u.id, u.fullName]))
}

export async function getWorkspaceGroups(workspaceId: number): Promise<Group[]> {
    const client = await getCommsClient()
    return client.groups.getGroups(workspaceId)
}

export async function getGroup(id: string, workspaceId: number): Promise<Group> {
    const client = await getCommsClient()
    return client.groups.getGroup({ id, workspaceId })
}

export async function createGroup(args: {
    workspaceId: number
    name: string
    userIds?: number[]
}): Promise<Group> {
    const client = await getCommsClient()
    return client.groups.createGroup(args)
}

export async function updateGroup(args: {
    id: string
    workspaceId: number
    name?: string
}): Promise<Group> {
    const client = await getCommsClient()
    return client.groups.updateGroup(args)
}

export async function deleteGroup(id: string, workspaceId: number): Promise<void> {
    const client = await getCommsClient()
    await client.groups.deleteGroup({ id, workspaceId })
}

export async function addUsersToGroup(
    id: string,
    workspaceId: number,
    userIds: number[],
): Promise<void> {
    const client = await getCommsClient()
    await client.groups.addUsers({ id, workspaceId, userIds })
}

export async function removeUsersFromGroup(
    id: string,
    workspaceId: number,
    userIds: number[],
): Promise<void> {
    const client = await getCommsClient()
    await client.groups.removeUsers({ id, workspaceId, userIds })
}

export async function addUsersToChannel(id: string, userIds: number[]): Promise<void> {
    const client = await getCommsClient()
    await client.channels.addUsers({ id, userIds })
}

export async function removeUsersFromChannel(id: string, userIds: number[]): Promise<void> {
    const client = await getCommsClient()
    await client.channels.removeUsers({ id, userIds })
}

export function clearUserCache(): void {
    sessionUserCache = null
}

export type { Group, User, Workspace, WorkspaceUser }

import type { Channel, Group, Workspace } from '@doist/comms-sdk'
import { fetchWorkspaces, getGroup, getWorkspaceGroups, getCommsClient } from './api.js'
import { CliError, type ErrorCode } from './errors.js'

function normalizeRef(ref: string): string {
    return ref.trim()
}

export function isIdRef(ref: string): boolean {
    return normalizeRef(ref).startsWith('id:')
}

/**
 * Returns the raw id portion of `123`, `id:123`, or `id:abc-xyz`. The Comms
 * backend uses numeric ids for users and workspaces and base58 UUIDv7 strings
 * for everything else, so this stays string-typed and consumers narrow as
 * needed (`Number(...)` for numeric refs after validation).
 */
export function extractId(ref: string): string {
    const normalized = normalizeRef(ref)
    const idStr = isIdRef(normalized) ? normalized.slice(3).trim() : normalized
    if (!idStr) {
        throw new CliError('INVALID_ID', `Invalid ID: ${ref}`)
    }
    return idStr
}

export function extractNumericId(ref: string): number {
    const idStr = extractId(ref)
    if (!/^\d+$/.test(idStr)) {
        throw new CliError('INVALID_ID', `Invalid numeric ID: ${ref}`)
    }
    return Number(idStr)
}

export function parseNumericIdRefs(refs: string, label = 'reference'): number[] | null {
    const ids: number[] = []

    for (const rawRef of refs.split(',')) {
        const ref = rawRef.trim()
        if (!ref) {
            throw new CliError('INVALID_REF', `Invalid ${label} reference list: found empty value`)
        }

        const id = extractId(ref)
        if (!/^\d+$/.test(id)) {
            return null
        }

        ids.push(Number(id))
    }

    return ids
}

export function looksLikeRawId(ref: string): boolean {
    const normalized = normalizeRef(ref)
    if (!normalized || normalized.includes(' ')) return false
    return /^[A-Za-z0-9_-]+$/.test(normalized) && /\d/.test(normalized)
}

export interface ParsedCommsUrl {
    workspaceId?: number
    channelId?: string
    threadId?: string
    commentId?: string
    conversationId?: string
    messageId?: string
}

export function parseCommsUrl(url: string): ParsedCommsUrl | null {
    try {
        const parsed = new URL(url)
        if (!parsed.hostname.includes('comms.todoist.com')) {
            return null
        }

        const path = parsed.pathname
        const result: ParsedCommsUrl = {}

        // Pattern: /a/{workspaceId}/ch/{channelId}/t/{threadId}/c/{commentId}
        // Pattern: /a/{workspaceId}/msg/{conversationId}/m/{messageId}
        const workspaceMatch = path.match(/\/a\/(\d+)/)
        if (workspaceMatch) {
            result.workspaceId = parseInt(workspaceMatch[1], 10)
        }

        const channelMatch = path.match(/\/ch\/([A-Za-z0-9_-]+)/)
        if (channelMatch) {
            result.channelId = channelMatch[1]
        }

        const threadMatch = path.match(/\/t\/([A-Za-z0-9_-]+)/)
        if (threadMatch) {
            result.threadId = threadMatch[1]
        }

        const commentMatch = path.match(/\/c\/([A-Za-z0-9_-]+)/)
        if (commentMatch) {
            result.commentId = commentMatch[1]
        }

        const conversationMatch = path.match(/\/msg\/([A-Za-z0-9_-]+)/)
        if (conversationMatch) {
            result.conversationId = conversationMatch[1]
        }

        const messageMatch = path.match(/\/m\/([A-Za-z0-9_-]+)/)
        if (messageMatch) {
            result.messageId = messageMatch[1]
        }

        return Object.keys(result).length > 0 ? result : null
    } catch {
        return null
    }
}

export type ParsedRef =
    | { type: 'id'; id: string }
    | { type: 'url'; parsed: ParsedCommsUrl }
    | { type: 'name'; name: string }

export function parseRef(ref: string): ParsedRef {
    const normalized = normalizeRef(ref)

    if (isIdRef(normalized)) {
        return { type: 'id', id: extractId(normalized) }
    }

    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        const parsed = parseCommsUrl(normalized)
        if (parsed) {
            return { type: 'url', parsed }
        }
    }

    if (looksLikeRawId(normalized)) {
        return { type: 'id', id: normalized }
    }

    return { type: 'name', name: normalized }
}

/**
 * Match an entity by name: exact (case-insensitive) → unique substring → ambiguous/not-found.
 */
function matchByName<T extends { id: number | string; name: string }>(
    items: T[],
    query: string,
    opts: {
        ambiguousCode: ErrorCode
        notFoundCode: ErrorCode
        ref: string
        listHint: string
    },
): T {
    const lower = query.toLowerCase()
    const exact = items.find((item) => item.name.toLowerCase() === lower)
    if (exact) return exact

    const partial = items.filter((item) => item.name.toLowerCase().includes(lower))
    if (partial.length === 1) return partial[0]
    if (partial.length > 1) {
        const matches = partial
            .slice(0, 5)
            .map((item) => `"${item.name}" (id:${item.id})`)
            .join(', ')
        throw new CliError(opts.ambiguousCode, `Multiple matches for "${opts.ref}": ${matches}`, [
            'Use the numeric ID (e.g. id:123) to specify exactly which one.',
        ])
    }

    throw new CliError(opts.notFoundCode, `"${opts.ref}" not found`, [opts.listHint])
}

export async function resolveWorkspaceRef(ref: string): Promise<Workspace> {
    const workspaces = await fetchWorkspaces()
    const parsed = parseRef(ref)

    if (parsed.type === 'id') {
        const numericId = Number(parsed.id)
        if (!Number.isFinite(numericId)) {
            throw new CliError('WORKSPACE_NOT_FOUND', `Workspace with ID ${parsed.id} not found`, [
                'Run: tdc workspaces to list available workspaces',
            ])
        }
        const workspace = workspaces.find((w) => w.id === numericId)
        if (!workspace) {
            throw new CliError('WORKSPACE_NOT_FOUND', `Workspace with ID ${parsed.id} not found`, [
                'Run: tdc workspaces to list available workspaces',
            ])
        }
        return workspace
    }

    if (parsed.type === 'url' && parsed.parsed.workspaceId) {
        const workspace = workspaces.find((w) => w.id === parsed.parsed.workspaceId)
        if (!workspace) {
            throw new CliError(
                'WORKSPACE_NOT_FOUND',
                `Workspace with ID ${parsed.parsed.workspaceId} not found`,
                ['Run: tdc workspaces to list available workspaces'],
            )
        }
        return workspace
    }

    if (parsed.type === 'name') {
        return matchByName(workspaces, parsed.name, {
            ambiguousCode: 'AMBIGUOUS_WORKSPACE',
            notFoundCode: 'WORKSPACE_NOT_FOUND',
            ref,
            listHint: 'Run: tdc workspaces to list available workspaces',
        })
    }

    throw new CliError('WORKSPACE_NOT_FOUND', `Workspace "${ref}" not found`, [
        'Run: tdc workspaces to list available workspaces',
    ])
}

export function resolveThreadId(ref: string): string {
    const parsed = parseRef(ref)

    if (parsed.type === 'id') {
        return parsed.id
    }

    if (parsed.type === 'url' && parsed.parsed.threadId) {
        return parsed.parsed.threadId
    }

    throw new CliError(
        'INVALID_REF',
        `Invalid thread reference: ${ref}. Use an id, id:<id>, or a Comms URL.`,
    )
}

function assertChannelInWorkspace(channel: Channel, workspaceId: number): void {
    if (channel.workspaceId !== workspaceId) {
        throw new CliError(
            'CHANNEL_NOT_FOUND',
            `Channel ${channel.id} does not belong to workspace ${workspaceId}`,
        )
    }
}

export async function resolveChannelRef(ref: string, workspaceId: number): Promise<Channel> {
    const parsed = parseRef(ref)
    const client = await getCommsClient()

    if (parsed.type === 'id') {
        const channel = await client.channels.getChannel(parsed.id)
        assertChannelInWorkspace(channel, workspaceId)
        return channel
    }

    if (parsed.type === 'url' && parsed.parsed.channelId) {
        if (parsed.parsed.workspaceId && parsed.parsed.workspaceId !== workspaceId) {
            throw new CliError(
                'CHANNEL_NOT_FOUND',
                `Channel URL belongs to workspace ${parsed.parsed.workspaceId}, but the current workspace is ${workspaceId}`,
                ['Pass the matching workspace-ref or use the default workspace that owns the URL.'],
            )
        }
        const channel = await client.channels.getChannel(parsed.parsed.channelId)
        assertChannelInWorkspace(channel, workspaceId)
        return channel
    }

    if (parsed.type === 'name') {
        // getChannels is membership-scoped — it returns only channels the current user has
        // joined (across active + archived). Public channels the user hasn't joined are not
        // included, so name-resolving e.g. `tdc channel archive "Old Public Channel"` would
        // fail with CHANNEL_NOT_FOUND even though the channel is discoverable. Merge with
        // getPublicChannels (workspace-scoped, returns all public channels regardless of
        // membership) and dedupe by id so a joined-and-public channel doesn't match twice.
        const [joined, publicChannels] = await Promise.all([
            client.channels.getChannels({ workspaceId }),
            client.workspaces.getPublicChannels(workspaceId),
        ])
        const joinedIds = new Set(joined.map((channel) => channel.id))
        const channels = [
            ...joined,
            ...publicChannels.filter((channel) => !joinedIds.has(channel.id)),
        ]
        return matchByName(channels, parsed.name, {
            ambiguousCode: 'AMBIGUOUS_CHANNEL',
            notFoundCode: 'CHANNEL_NOT_FOUND',
            ref,
            listHint: 'Run: tdc channels to list available channels',
        })
    }

    throw new CliError('CHANNEL_NOT_FOUND', `Channel "${ref}" not found`, [
        'Run: tdc channels to list available channels',
    ])
}

export function resolveChannelId(ref: string): string {
    const channelId = getDirectChannelId(ref)
    if (channelId) return channelId

    throw new CliError(
        'INVALID_REF',
        `Invalid channel reference: ${ref}. Use an id, id:<id>, or a Comms URL.`,
    )
}

export function getDirectChannelId(ref: string): string | null {
    const parsed = parseRef(ref)

    if (parsed.type === 'id') {
        return parsed.id
    }

    if (parsed.type === 'url') {
        if (parsed.parsed.channelId) {
            return parsed.parsed.channelId
        }
        throw new CliError(
            'INVALID_REF',
            `Invalid channel reference: ${ref}. Use an id, id:<id>, or a Comms URL.`,
        )
    }

    return null
}

export function resolveCommentId(ref: string): string {
    const parsed = parseRef(ref)

    if (parsed.type === 'id') {
        return parsed.id
    }

    if (parsed.type === 'url' && parsed.parsed.commentId) {
        return parsed.parsed.commentId
    }

    throw new CliError(
        'INVALID_REF',
        `Invalid comment reference: ${ref}. Use an id, id:<id>, or a Comms URL.`,
    )
}

export function resolveConversationId(ref: string): string {
    const parsed = parseRef(ref)

    if (parsed.type === 'id') {
        return parsed.id
    }

    if (parsed.type === 'url' && parsed.parsed.conversationId) {
        return parsed.parsed.conversationId
    }

    throw new CliError(
        'INVALID_REF',
        `Invalid conversation reference: ${ref}. Use an id, id:<id>, or a Comms URL.`,
    )
}

export function resolveMessageId(ref: string): string {
    const parsed = parseRef(ref)

    if (parsed.type === 'id') {
        return parsed.id
    }

    if (parsed.type === 'url' && parsed.parsed.messageId) {
        return parsed.parsed.messageId
    }

    throw new CliError(
        'INVALID_REF',
        `Invalid message reference: ${ref}. Use an id, id:<id>, or a Comms URL.`,
    )
}

export type CommsUrlRoute = {
    entityType: 'message' | 'conversation' | 'comment' | 'thread'
    url: string
}

export function classifyCommsUrl(url: string): CommsUrlRoute | null {
    const parsed = parseCommsUrl(url)
    if (!parsed) return null

    if (parsed.messageId) return { entityType: 'message', url }
    if (parsed.conversationId && !parsed.messageId) return { entityType: 'conversation', url }
    if (parsed.commentId) return { entityType: 'comment', url }
    if (parsed.threadId && !parsed.commentId) return { entityType: 'thread', url }

    return null
}

/**
 * Split a list of notify refs into numeric user IDs and base58 group IDs by
 * checking each ref against the workspace's known group IDs. Anything not in
 * the group set is treated as a user ID and parsed as a number.
 */
export function partitionNotifyIds(
    ids: readonly string[],
    groupIds: ReadonlySet<string>,
): { userIds: number[]; groupIds: string[] } {
    const users: number[] = []
    const groups: string[] = []
    for (const id of ids) {
        if (groupIds.has(id)) {
            groups.push(id)
            continue
        }
        const num = Number(id)
        if (!Number.isFinite(num) || !/^\d+$/.test(id)) {
            throw new CliError(
                'INVALID_REF',
                `Invalid notify ID "${id}": expected a numeric user ID or a known group ID.`,
            )
        }
        users.push(num)
    }
    return { userIds: users, groupIds: groups }
}

/**
 * Parse a comma-separated list of notify refs into raw IDs (untyped — callers
 * use {@link partitionNotifyIds} to split into users vs. groups).
 */
export function parseNotifyIdRefs(refs: string): string[] {
    return refs.split(',').map((userRef) => {
        const trimmed = userRef.trim()
        if (!trimmed) {
            throw new CliError('INVALID_REF', 'Invalid notify reference list: found empty value')
        }
        try {
            return extractId(trimmed)
        } catch {
            throw new CliError(
                'INVALID_REF',
                `Invalid notify reference: ${trimmed}. Use a user or group id.`,
            )
        }
    })
}

export async function resolveGroupRef(ref: string, workspaceId: number): Promise<Group> {
    const parsed = parseRef(ref)

    if (parsed.type === 'id') {
        try {
            const group = await getGroup(parsed.id, workspaceId)
            if (group.workspaceId !== workspaceId) {
                throw new CliError(
                    'GROUP_NOT_FOUND',
                    `Group ${parsed.id} does not belong to workspace ${workspaceId}`,
                )
            }
            return group
        } catch (error) {
            if (error instanceof CliError) throw error
            throw new CliError('GROUP_NOT_FOUND', `Group with ID ${parsed.id} not found`, [
                'Run: tdc groups to list available groups',
            ])
        }
    }

    if (parsed.type === 'name') {
        const groups = await getWorkspaceGroups(workspaceId)
        return matchByName(groups, parsed.name, {
            ambiguousCode: 'AMBIGUOUS_GROUP',
            notFoundCode: 'GROUP_NOT_FOUND',
            ref,
            listHint: 'Run: tdc groups to list available groups',
        })
    }

    throw new CliError('GROUP_NOT_FOUND', `Group "${ref}" not found`, [
        'Run: tdc groups to list available groups',
    ])
}

export type ChannelMemberRefs = {
    userIds: number[]
    expandedFrom: { groupId: string; groupName: string; userIds: number[] }[]
}

const GROUP_REF_PREFIX = 'group:'

/**
 * Resolve a mixed list of user and `group:<ref>` references for channel membership.
 *
 * Groups are expanded to their current `userIds` at call time. The group itself
 * is not persistently linked to the channel — callers should surface that
 * caveat in user-facing help text.
 *
 * Returns deduped userIds in input order, with a parallel `expandedFrom` list
 * recording which groups contributed (and which users each group brought in,
 * pre-dedup) for reporting purposes.
 */
export async function resolveChannelMemberRefs(
    refs: string[],
    workspaceId: number,
): Promise<ChannelMemberRefs> {
    if (refs.length === 0) {
        throw new CliError('MISSING_USERS', 'Provide at least one user or group:<ref> reference.')
    }

    type Slot =
        | { kind: 'user'; ref: string; index: number }
        | { kind: 'group'; ref: string; index: number }
    const slots: Slot[] = refs.map((ref, index) => {
        const trimmed = normalizeRef(ref)
        if (trimmed.toLowerCase().startsWith(GROUP_REF_PREFIX)) {
            const inner = trimmed.slice(GROUP_REF_PREFIX.length).trim()
            if (!inner) {
                throw new CliError(
                    'INVALID_REF',
                    `Empty group reference: "${ref}". Use group:<id|name>.`,
                )
            }
            return { kind: 'group', ref: inner, index }
        }
        return { kind: 'user', ref: trimmed, index }
    })

    const userSlots = slots.filter((s): s is Extract<Slot, { kind: 'user' }> => s.kind === 'user')
    const groupSlots = slots.filter(
        (s): s is Extract<Slot, { kind: 'group' }> => s.kind === 'group',
    )
    // A group ref resolves by id (single fetch) or by name (matched against the
    // workspace group list). Split here so name refs share one list fetch
    // instead of re-fetching the whole list per ref.
    const groupIdSlots = groupSlots.filter((s) => parseRef(s.ref).type === 'id')
    const groupNameSlots = groupSlots.filter((s) => parseRef(s.ref).type !== 'id')

    // Resolve each user slot individually (a single ref may expand to several
    // ids, e.g. a comma list or a name match), all groups by id, and the
    // workspace group list (once, only when there are name refs) concurrently.
    const [userIdsPerSlot, idGroups, workspaceGroups] = await Promise.all([
        Promise.all(userSlots.map((s) => resolveUserRefs(s.ref, workspaceId))),
        Promise.all(groupIdSlots.map((s) => resolveGroupRef(s.ref, workspaceId))),
        groupNameSlots.length > 0
            ? getWorkspaceGroups(workspaceId)
            : Promise.resolve([] as Group[]),
    ])

    const userIdsByIndex = new Map<number, number[]>()
    userSlots.forEach((s, i) => {
        userIdsByIndex.set(s.index, userIdsPerSlot[i])
    })

    const groupByIndex = new Map<number, Group>()
    groupIdSlots.forEach((s, i) => {
        groupByIndex.set(s.index, idGroups[i])
    })
    for (const s of groupNameSlots) {
        groupByIndex.set(
            s.index,
            matchByName(workspaceGroups, s.ref, {
                ambiguousCode: 'AMBIGUOUS_GROUP',
                notFoundCode: 'GROUP_NOT_FOUND',
                ref: s.ref,
                listHint: 'Run: tdc groups to list available groups',
            }),
        )
    }

    // Walk the original input order to assemble dedup'd userIds and expandedFrom.
    const expandedFrom: ChannelMemberRefs['expandedFrom'] = []
    const seen = new Set<number>()
    const userIds: number[] = []
    const pushId = (id: number) => {
        if (!seen.has(id)) {
            seen.add(id)
            userIds.push(id)
        }
    }

    for (let i = 0; i < refs.length; i++) {
        const slotUserIds = userIdsByIndex.get(i)
        if (slotUserIds) {
            for (const id of slotUserIds) pushId(id)
            continue
        }
        const group = groupByIndex.get(i)
        if (!group) continue
        expandedFrom.push({
            groupId: group.id,
            groupName: group.name,
            userIds: [...group.userIds],
        })
        for (const id of group.userIds) pushId(id)
    }

    return { userIds, expandedFrom }
}

export async function resolveUserRefs(refs: string, workspaceId: number): Promise<number[]> {
    const numericIds = parseNumericIdRefs(refs, 'user')
    if (numericIds) return numericIds

    const { getWorkspaceUsers } = await import('./api.js')
    const users = await getWorkspaceUsers(workspaceId)

    const parts = refs.split(',').map((r) => r.trim())
    const ids: number[] = []

    for (const ref of parts) {
        const parsed = parseRef(ref)
        if (parsed.type === 'id') {
            const num = Number(parsed.id)
            if (!Number.isFinite(num) || !/^\d+$/.test(parsed.id)) {
                throw new CliError('INVALID_REF', `Invalid user ID: ${ref}`)
            }
            ids.push(num)
            continue
        }

        const query = ref.toLowerCase()
        const matches = users.filter(
            (u) =>
                u.fullName.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query),
        )

        if (matches.length === 0) {
            throw new CliError('USER_NOT_FOUND', `No user found matching "${ref}"`, [
                'Run: tdc users to list workspace members',
            ])
        }

        if (matches.length > 1) {
            const list = matches
                .map((u) => `  ${u.id}  ${u.fullName} <${u.email ?? ''}>`)
                .join('\n')
            throw new CliError(
                'AMBIGUOUS_USER',
                `Multiple users match "${ref}":\n${list}\n\nUse numeric ID to specify.`,
            )
        }

        ids.push(matches[0].id)
    }

    return ids
}

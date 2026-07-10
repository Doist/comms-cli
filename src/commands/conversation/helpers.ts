import type { Conversation } from '@doist/comms-sdk'
import chalk from 'chalk'
import { buildUserNameMap, getCommsClient } from '../../lib/api.js'
import { formatRelativeDate } from '../../lib/dates.js'
import { CliError } from '../../lib/errors.js'
import { isAccessible } from '../../lib/global-args.js'
import { renderMarkdown } from '../../lib/markdown.js'
import type { MutationOptions, PaginatedViewOptions, ViewOptions } from '../../lib/options.js'
import { colors, formatJson, formatNdjson, printEmpty } from '../../lib/output.js'

export type UnreadOptions = ViewOptions & { workspace?: string }

export type ConversationViewOptions = PaginatedViewOptions

export type ConversationWithOptions = PaginatedViewOptions & {
    workspace?: string
    includeGroups?: boolean
    snippet?: boolean
}

export type ConversationListOptions = ViewOptions & {
    workspace?: string
    participant?: string
    name?: string
    kind?: string
    state?: string
    snippet?: boolean
    limit?: string
}

/** Fields the conversation renderer reads — satisfied by both `with` and `list` options. */
export type ConversationRenderOptions = {
    json?: boolean
    ndjson?: boolean
    full?: boolean
    snippet?: boolean
}

export type ConversationState = 'active' | 'all' | 'archived'

export type ReplyOptions = MutationOptions & { file?: string[] }

export type MuteOptions = MutationOptions & { minutes?: string }

export type DoneOptions = MutationOptions

export type ConversationLookupResult = {
    directConversation?: Conversation
    groupConversationCount: number
}

export function buildConversationTitle(
    conversation: Pick<Conversation, 'title' | 'userIds'>,
    userMap: Map<number, string>,
): string {
    const participants = conversation.userIds
        .map((id) => userMap.get(id) || `user:${id}`)
        .join(', ')
    return conversation.title || `Conversation with ${participants}`
}

export function conversationLabel(conversation: Pick<Conversation, 'id' | 'title'>): string {
    return conversation.title
        ? `${conversation.title} (${conversation.id})`
        : `conversation ${conversation.id}`
}

export function sortByLastActiveDescending(a: Conversation, b: Conversation): number {
    return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
}

const CONVERSATION_PAGE_LIMIT = 500

/**
 * Stream a workspace's conversations page by page for one archived state
 * (undefined = active and archived in a single stream). Each request
 * continues from the previous page's last row via the strict compound
 * (lastActive, id) cursor, so quiet conversations far down the list are
 * still reached. Only rows unseen on earlier pages are yielded: older
 * servers repeat the boundary row, and consumers must not process it
 * twice.
 */
async function* iterateConversationPages(
    workspaceId: number,
    archived: boolean | undefined,
): AsyncGenerator<Conversation[]> {
    const client = await getCommsClient()
    const seenIds = new Set<string>()
    let cursor: { olderThan: Date; beforeId: string } | undefined

    for (;;) {
        const page = await client.conversations.getConversations({
            workspaceId,
            limit: CONVERSATION_PAGE_LIMIT,
            ...(archived === undefined ? {} : { archived }),
            ...cursor,
        })

        const unseen = page.filter((conversation) => !seenIds.has(conversation.id))
        for (const conversation of unseen) seenIds.add(conversation.id)
        yield unseen

        if (page.length < CONVERSATION_PAGE_LIMIT) return
        if (unseen.length === 0) {
            // A full page of only known rows means the cursor is not
            // advancing; truncating silently is how conversations "disappear".
            throw new CliError(
                'PAGINATION_STALLED',
                `conversations/get returned a full page with no new conversations (workspace ${workspaceId}); results would be incomplete`,
            )
        }
        const boundary = page[page.length - 1] as Conversation
        cursor = { olderThan: new Date(boundary.lastActive), beforeId: boundary.id }
    }
}

async function fetchAllConversations(
    workspaceId: number,
    archived: boolean | undefined,
): Promise<Conversation[]> {
    const conversations: Conversation[] = []
    for await (const page of iterateConversationPages(workspaceId, archived)) {
        conversations.push(...page)
    }
    return conversations
}

/**
 * Fetch ALL of a workspace's conversations for the requested
 * {@link ConversationState}, sorted by last activity (newest first).
 * `active`/`archived` page one filtered stream each; `all` pages the
 * server's unfiltered stream once.
 */
export async function getConversationsByState(
    workspaceId: number,
    state: ConversationState = 'all',
): Promise<Conversation[]> {
    const archived = state === 'all' ? undefined : state === 'archived'
    const conversations = await fetchAllConversations(workspaceId, archived)
    return conversations.sort(sortByLastActiveDescending)
}

function scanForDirectConversation(
    conversations: readonly Conversation[],
    sessionUserId: number,
    targetUserId: number,
): { match?: Conversation; extraGroupCount: number } {
    let extraGroupCount = 0
    for (const conversation of conversations) {
        if (!conversation.userIds.includes(targetUserId)) continue

        const isSelfConversation = sessionUserId === targetUserId
        const isDirect = isSelfConversation
            ? conversation.userIds.length === 1
            : conversation.userIds.length === 2 && conversation.userIds.includes(sessionUserId)

        if (isDirect) return { match: conversation, extraGroupCount }

        if (conversation.userIds.length > (isSelfConversation ? 1 : 2)) {
            extraGroupCount += 1
        }
    }
    return { extraGroupCount }
}

export async function findDirectConversation(
    workspaceId: number,
    sessionUserId: number,
    targetUserId: number,
): Promise<ConversationLookupResult> {
    let groupConversationCount = 0
    // Active first — only scan archived on miss; stop at the first match.
    for (const archived of [false, true]) {
        for await (const page of iterateConversationPages(workspaceId, archived)) {
            const scan = scanForDirectConversation(page, sessionUserId, targetUserId)
            groupConversationCount += scan.extraGroupCount
            if (scan.match) {
                return { directConversation: scan.match, groupConversationCount }
            }
        }
    }
    return { groupConversationCount }
}

export async function renderConversationList(
    conversations: Conversation[],
    workspaceId: number,
    options: ConversationRenderOptions,
): Promise<void> {
    if (conversations.length === 0) {
        printEmpty({
            options,
            type: 'conversation',
            message: 'No matching conversations found.',
        })
        return
    }

    // Machine output without --full filters `participantNames` back out, so skip
    // the workspace-wide user-map fetch whose names would never be emitted.
    if ((options.json || options.ndjson) && !options.full) {
        if (options.json) {
            console.log(formatJson(conversations, 'conversation', false))
        } else {
            console.log(formatNdjson(conversations, 'conversation', false))
        }
        return
    }

    const client = await getCommsClient()
    const userMap = await buildUserNameMap(workspaceId, client)

    const output = conversations.map((conversation) => ({
        ...conversation,
        participantNames: conversation.userIds.map((id) => userMap.get(id)),
    }))

    if (options.json) {
        console.log(formatJson(output, 'conversation', options.full))
        return
    }

    if (options.ndjson) {
        console.log(formatNdjson(output, 'conversation', options.full))
        return
    }

    for (const conversation of conversations) {
        const title = buildConversationTitle(conversation, userMap)
        const archivedBadge = conversation.archived
            ? chalk.yellow(isAccessible() ? ' (archived)' : ' [archived]')
            : ''

        console.log(`${chalk.bold(title)}${archivedBadge}`)
        const participants = conversation.userIds
            .map((id) => userMap.get(id) || `user:${id}`)
            .join(', ')
        console.log(
            `  ${colors.timestamp(`id:${conversation.id}`)}  ${colors.author(participants)}`,
        )
        if (options.snippet && conversation.snippet) {
            console.log(await renderMarkdown(conversation.snippet))
        }
        console.log(`  ${colors.timestamp(formatRelativeDate(conversation.lastActive))}`)
        console.log(`  ${colors.url(conversation.url)}`)
        console.log('')
    }
}

export function parseMinutes(value: string | undefined): number {
    if (!value) return 60
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new CliError(
            'INVALID_MINUTES',
            `Invalid --minutes value: ${value} (must be a positive integer)`,
        )
    }
    return parsed
}

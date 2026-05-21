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

export type ReplyOptions = MutationOptions

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

export async function getAllConversations(workspaceId: number): Promise<Conversation[]> {
    const client = await getCommsClient()
    const [active, archived] = await Promise.all([
        client.conversations.getConversations({ workspaceId }),
        client.conversations.getConversations({ workspaceId, archived: true }),
    ])

    const byId = new Map<string, Conversation>()
    for (const conversation of [...active, ...archived]) {
        byId.set(conversation.id, conversation)
    }

    return [...byId.values()].sort(sortByLastActiveDescending)
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
    const client = await getCommsClient()
    // Active first — only scan archived on miss.
    const active = await client.conversations.getConversations({ workspaceId })
    const activeScan = scanForDirectConversation(active, sessionUserId, targetUserId)
    if (activeScan.match) {
        return {
            directConversation: activeScan.match,
            groupConversationCount: activeScan.extraGroupCount,
        }
    }

    const archived = await client.conversations.getConversations({ workspaceId, archived: true })
    const archivedScan = scanForDirectConversation(archived, sessionUserId, targetUserId)
    return {
        directConversation: archivedScan.match,
        groupConversationCount: activeScan.extraGroupCount + archivedScan.extraGroupCount,
    }
}

export async function listConversationsWithUser(
    conversations: Conversation[],
    workspaceId: number,
    options: ConversationWithOptions,
): Promise<void> {
    if (conversations.length === 0) {
        printEmpty({
            options,
            type: 'conversation',
            message: 'No matching conversations found.',
        })
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

import chalk from 'chalk'
import { buildUserNameMap, getCommsClient, getCurrentWorkspaceId } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { isAccessible } from '../../lib/global-args.js'
import { colors, formatJson, formatNdjson, printEmpty } from '../../lib/output.js'
import { resolveWorkspaceRef } from '../../lib/refs.js'
import type { UnreadOptions } from './helpers.js'

export async function showUnread(
    workspaceRef: string | undefined,
    options: UnreadOptions,
): Promise<void> {
    if (workspaceRef && options.workspace) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot specify workspace both as argument and --workspace flag',
        )
    }

    let workspaceId: number
    const ref = workspaceRef || options.workspace

    if (ref) {
        const workspace = await resolveWorkspaceRef(ref)
        workspaceId = workspace.id
    } else {
        workspaceId = await getCurrentWorkspaceId()
    }

    const client = await getCommsClient()
    const unreadResponse = await client.conversations.getUnread(workspaceId)
    const unreadConversations = unreadResponse.data

    if (unreadConversations.length === 0) {
        printEmpty({ options, type: 'conversation', message: 'No unread conversations.' })
        return
    }

    const conversations = await Promise.all(
        unreadConversations.map((uc) => client.conversations.getConversation(uc.conversationId)),
    )

    const userMap = await buildUserNameMap(workspaceId, client)

    if (options.json) {
        const output = conversations.map((c) => ({
            ...c,
            participantNames: c.userIds.map((id) => userMap.get(id)),
        }))
        console.log(formatJson(output, 'conversation', options.full))
        return
    }

    if (options.ndjson) {
        const output = conversations.map((c) => ({
            ...c,
            participantNames: c.userIds.map((id) => userMap.get(id)),
        }))
        console.log(formatNdjson(output, 'conversation', options.full))
        return
    }

    for (const conv of conversations) {
        const participants = conv.userIds.map((id) => userMap.get(id) || `user:${id}`).join(', ')
        const title = conv.title || `Conversation with ${participants}`
        const unreadInfo = unreadConversations.find((uc) => uc.conversationId === conv.id)
        const unreadBadge = unreadInfo ? chalk.blue(isAccessible() ? ' (unread)' : ' *') : ''

        console.log(`${chalk.bold(title)}${unreadBadge}`)
        console.log(`  ${colors.timestamp(`id:${conv.id}`)}  ${colors.author(participants)}`)
        console.log(`  ${colors.url(conv.url)}`)
        console.log('')
    }
}

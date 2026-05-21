import chalk from 'chalk'
import { buildUserNameMap, getCommsClient } from '../../lib/api.js'
import { formatRelativeDate } from '../../lib/dates.js'
import { renderMarkdown } from '../../lib/markdown.js'
import { colors, filterEntityFields } from '../../lib/output.js'
import { resolveConversationId } from '../../lib/refs.js'
import { buildConversationTitle, type ConversationViewOptions } from './helpers.js'

export async function viewConversation(
    ref: string,
    options: ConversationViewOptions,
): Promise<void> {
    const conversationId = resolveConversationId(ref)
    const client = await getCommsClient()
    const limit = options.limit ? parseInt(options.limit, 10) : 50

    const [conversation, messages] = await Promise.all([
        client.conversations.getConversation(conversationId),
        client.conversationMessages.getMessages({ conversationId, limit }),
    ])

    const userMap = await buildUserNameMap(conversation.workspaceId, client)

    const conversationOutput = {
        ...conversation,
        participantNames: conversation.userIds.map((id) => userMap.get(id)),
    }
    const messageOutput = messages.map((m) => ({
        ...m,
        creatorName: userMap.get(m.creator),
    }))

    if (options.json) {
        const output = {
            conversation: filterEntityFields(conversationOutput, 'conversation', options.full),
            messages: filterEntityFields(messageOutput, 'message', options.full),
        }
        console.log(JSON.stringify(output, null, 2))
        return
    }

    if (options.ndjson) {
        console.log(
            JSON.stringify({
                type: 'conversation',
                ...filterEntityFields(conversationOutput, 'conversation', options.full),
            }),
        )
        const formattedMessages = filterEntityFields(messageOutput, 'message', options.full)
        for (const message of formattedMessages) {
            console.log(JSON.stringify({ type: 'message', ...message }))
        }
        return
    }

    const title = buildConversationTitle(conversation, userMap)

    console.log(chalk.bold(title))
    console.log(colors.timestamp(`id:${conversation.id}`))
    console.log('')

    if (messages.length === 0) {
        console.log('No messages.')
        return
    }

    for (const message of messages) {
        const author = colors.author(userMap.get(message.creator) || `user:${message.creator}`)
        const time = colors.timestamp(formatRelativeDate(message.posted))
        console.log(`${author}  ${time}  ${colors.timestamp(`id:${message.id}`)}`)
        console.log(options.raw ? message.content : await renderMarkdown(message.content))
        console.log('')
    }
}

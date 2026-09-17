import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { resolveConversationId } from '../../lib/refs.js'
import { conversationLabel, type DoneOptions } from './helpers.js'

export async function markConversationUndone(ref: string, options: DoneOptions): Promise<void> {
    const conversationId = resolveConversationId(ref)

    const client = await getCommsClient()
    const conversation = await client.conversations.getConversation(conversationId)

    if (options.dryRun) {
        printDryRun('unarchive conversation', {
            Conversation: conversationLabel(conversation),
            Status: conversation.archived ? undefined : 'not archived',
        })
        return
    }

    if (!options.yes) {
        if (options.json) {
            throw new CliError(
                'MISSING_YES_FLAG',
                '--yes is required to execute unarchive in --json mode.',
            )
        }
        console.log(`Would unarchive: ${conversationLabel(conversation)}`)
        console.log('Use --yes to confirm.')
        return
    }

    await client.conversations.unarchiveConversation(conversationId)

    if (options.json) {
        console.log(formatJson({ id: conversationId, archived: false }))
        return
    }

    console.log(`Conversation ${conversationId} unarchived.`)
}

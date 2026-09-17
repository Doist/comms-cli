import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { resolveConversationId } from '../../lib/refs.js'
import { conversationLabel, type DoneOptions } from './helpers.js'

async function setConversationArchiveState(
    ref: string,
    options: DoneOptions,
    archive: boolean,
): Promise<void> {
    const action = archive ? 'archive' : 'unarchive'
    const conversationId = resolveConversationId(ref)

    const client = await getCommsClient()
    const conversation = await client.conversations.getConversation(conversationId)

    if (options.dryRun) {
        const noop = conversation.archived === archive
        printDryRun(`${action} conversation`, {
            Conversation: conversationLabel(conversation),
            Status: noop ? (archive ? 'already archived' : 'not archived') : undefined,
        })
        return
    }

    if (!options.yes) {
        if (options.json) {
            throw new CliError(
                'MISSING_YES_FLAG',
                `--yes is required to execute ${action} in --json mode.`,
            )
        }
        console.log(`Would ${action}: ${conversationLabel(conversation)}`)
        console.log('Use --yes to confirm.')
        return
    }

    if (archive) {
        await client.conversations.archiveConversation(conversationId)
    } else {
        await client.conversations.unarchiveConversation(conversationId)
    }

    if (options.json) {
        console.log(formatJson({ id: conversationId, archived: archive }))
        return
    }

    console.log(`Conversation ${conversationId} ${action}d.`)
}

export async function markConversationDone(ref: string, options: DoneOptions): Promise<void> {
    await setConversationArchiveState(ref, options, true)
}

export async function markConversationUndone(ref: string, options: DoneOptions): Promise<void> {
    await setConversationArchiveState(ref, options, false)
}

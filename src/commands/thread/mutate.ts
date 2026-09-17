import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { resolveThreadId } from '../../lib/refs.js'
import { threadLabel } from './helpers.js'

async function setThreadArchiveState(
    ref: string,
    options: MutationOptions,
    archive: boolean,
): Promise<void> {
    const action = archive ? 'archive' : 'unarchive'
    const threadId = resolveThreadId(ref)

    const client = await getCommsClient()
    const thread = await client.threads.getThread(threadId)
    await assertChannelIsPublic(thread.channelId, thread.workspaceId)

    if (options.dryRun) {
        printDryRun(`${action} thread`, {
            Thread: threadLabel(thread),
            Status: !archive && !thread.isArchived ? 'already in inbox' : undefined,
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
        console.log(`Would ${action}: ${threadLabel(thread)}`)
        console.log('Use --yes to confirm.')
        return
    }

    const noop = thread.isArchived === archive
    if (!noop) {
        if (archive) {
            await client.inbox.archiveThread(threadId)
        } else {
            await client.inbox.unarchiveThread(threadId)
        }
    }

    if (options.json) {
        console.log(formatJson({ id: threadId, isArchived: archive }))
        return
    }

    console.log(`Thread ${threadId} ${action}d${noop ? ' (already in target state)' : ''}.`)
}

export async function markThreadDone(ref: string, options: MutationOptions): Promise<void> {
    await setThreadArchiveState(ref, options, true)
}

export async function markThreadUndone(ref: string, options: MutationOptions): Promise<void> {
    await setThreadArchiveState(ref, options, false)
}

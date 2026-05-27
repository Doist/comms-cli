import { getCommsClient } from '../../lib/api.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { resolveChannelByRef } from './helpers.js'

type ArchiveChannelOptions = MutationOptions & { workspace?: string }

async function setArchiveState(
    ref: string,
    options: ArchiveChannelOptions,
    archive: boolean,
): Promise<void> {
    const action = archive ? 'archive' : 'unarchive'
    const channel = await resolveChannelByRef(ref, options.workspace)

    if (options.dryRun) {
        printDryRun(`${action} channel`, {
            Channel: `${channel.name} (id:${channel.id})`,
            'Currently archived': channel.archived ? 'yes' : 'no',
        })
        return
    }

    if (channel.archived !== archive) {
        const client = await getCommsClient()
        if (archive) {
            await client.channels.archiveChannel(channel.id)
        } else {
            await client.channels.unarchiveChannel(channel.id)
        }
    }

    if (options.json) {
        console.log(formatJson({ id: channel.id, archived: archive }))
        return
    }

    const verb = archive ? 'archived' : 'unarchived'
    const noop = channel.archived === archive ? ' (already in target state)' : ''
    console.log(`Channel "${channel.name}" (id:${channel.id}) ${verb}${noop}.`)
}

export async function archiveChannel(ref: string, options: ArchiveChannelOptions): Promise<void> {
    await setArchiveState(ref, options, true)
}

export async function unarchiveChannel(ref: string, options: ArchiveChannelOptions): Promise<void> {
    await setArchiveState(ref, options, false)
}

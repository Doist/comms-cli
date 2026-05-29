import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { resolveChannelByRef } from './helpers.js'

type DeleteChannelOptions = MutationOptions & { yes?: boolean; workspace?: string }

export async function deleteChannel(ref: string, options: DeleteChannelOptions): Promise<void> {
    if (!options.yes && !options.dryRun) {
        if (options.json) {
            throw new CliError(
                'MISSING_YES_FLAG',
                '--yes is required to execute deletion in --json mode.',
            )
        }
        console.log(`Would delete: ${ref}`)
        console.log('Use --yes to confirm.')
        return
    }

    const channel = await resolveChannelByRef(ref, options.workspace)

    if (options.dryRun) {
        printDryRun('delete channel', {
            Channel: `${channel.name} (id:${channel.id})`,
            Visibility: channel.public ? 'public' : 'private',
        })
        return
    }

    const client = await getCommsClient()
    await client.channels.deleteChannel(channel.id)

    if (options.json) {
        console.log(formatJson({ id: channel.id, deleted: true }))
        return
    }

    console.log(`Channel "${channel.name}" (id:${channel.id}) deleted.`)
}

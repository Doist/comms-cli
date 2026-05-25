import type { CreateChannelArgs } from '@doist/comms-sdk'
import { getCommsClient } from '../../lib/api.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { resolveUserRefs } from '../../lib/refs.js'
import {
    resolveChannelWorkspaceId,
    resolveVisibilityOption,
    validateChannelName,
} from './helpers.js'

type CreateChannelOptions = MutationOptions & {
    workspace?: string
    description?: string
    users?: string
    public?: boolean
    private?: boolean
}

export async function createChannel(name: string, options: CreateChannelOptions): Promise<void> {
    validateChannelName(name)
    const visibility = resolveVisibilityOption(options)

    const workspaceId = await resolveChannelWorkspaceId(options.workspace)
    const userIds = options.users ? await resolveUserRefs(options.users, workspaceId) : undefined

    const args: CreateChannelArgs = {
        workspaceId,
        name,
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(userIds !== undefined ? { userIds } : {}),
        ...(visibility !== undefined ? { public: visibility } : {}),
    }

    if (options.dryRun) {
        printDryRun('create channel', {
            Workspace: String(workspaceId),
            Name: name,
            Description: options.description,
            Visibility: visibility === undefined ? undefined : visibility ? 'public' : 'private',
            Users: userIds && userIds.length > 0 ? userIds.join(', ') : undefined,
        })
        return
    }

    const client = await getCommsClient()
    const channel = await client.channels.createChannel(args)

    if (options.json) {
        console.log(formatJson(channel, 'channel', options.full))
        return
    }

    console.log(`Channel "${channel.name}" (id:${channel.id}) created.`)
}

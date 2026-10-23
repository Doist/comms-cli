import type { Channel } from '@doist/comms-sdk'
import { getCommsClient } from './api.js'
import { CliError } from './errors.js'
import { includePrivateChannels } from './global-args.js'

type WorkspaceChannels = { channels: Channel[]; publicIds: Set<string> }

const channelCache = new Map<number, WorkspaceChannels>()

async function loadWorkspaceChannels(workspaceId: number): Promise<WorkspaceChannels> {
    const cached = channelCache.get(workspaceId)
    if (cached) return cached

    const client = await getCommsClient()
    const channels = await client.channels.getChannels({ workspaceId })
    const publicIds = new Set(channels.filter((ch) => ch.public).map((ch) => ch.id))
    const loaded = { channels, publicIds }
    channelCache.set(workspaceId, loaded)
    return loaded
}

export async function getWorkspaceChannels(workspaceId: number): Promise<Channel[]> {
    return (await loadWorkspaceChannels(workspaceId)).channels
}

export async function getPublicChannelIds(workspaceId: number): Promise<Set<string>> {
    return (await loadWorkspaceChannels(workspaceId)).publicIds
}

export function clearChannelCache(): void {
    channelCache.clear()
}

export async function assertChannelIsPublic(channelId: string, workspaceId: number): Promise<void> {
    if (includePrivateChannels()) return
    const publicIds = await getPublicChannelIds(workspaceId)
    if (!publicIds.has(channelId)) {
        throw new CliError('NOT_FOUND', 'This thread belongs to a private channel.', [
            'Use --include-private-channels to access it',
        ])
    }
}

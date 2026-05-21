import { getCommsClient } from './api.js'
import { CliError } from './errors.js'
import { includePrivateChannels } from './global-args.js'

const publicChannelCache = new Map<number, Set<string>>()

export async function getPublicChannelIds(workspaceId: number): Promise<Set<string>> {
    const cached = publicChannelCache.get(workspaceId)
    if (cached) return cached

    const client = await getCommsClient()
    const channels = await client.channels.getChannels({ workspaceId })
    const publicIds = new Set<string>()
    for (const ch of channels) {
        if (ch.public) publicIds.add(ch.id)
    }
    publicChannelCache.set(workspaceId, publicIds)
    return publicIds
}

export function clearPublicChannelCache(): void {
    publicChannelCache.clear()
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

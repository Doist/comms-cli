import { getCommsClient } from './api.js'
import { CliError } from './errors.js'
import { includePrivateChannels } from './global-args.js'

// Channel ID to whether it's public, for the channels the user has joined.
const joinedChannelCache = new Map<number, Map<string, boolean>>()
const workspacePublicChannelCache = new Map<number, Set<string>>()

async function getJoinedChannels(workspaceId: number): Promise<Map<string, boolean>> {
    const cached = joinedChannelCache.get(workspaceId)
    if (cached) return cached

    const client = await getCommsClient()
    const channels = await client.channels.getChannels({ workspaceId })
    const joined = new Map(channels.map((ch) => [ch.id, ch.public]))
    joinedChannelCache.set(workspaceId, joined)
    return joined
}

/** IDs of the public channels the user has joined. */
export async function getPublicChannelIds(workspaceId: number): Promise<Set<string>> {
    const joined = await getJoinedChannels(workspaceId)
    return new Set([...joined].filter(([, isPublic]) => isPublic).map(([id]) => id))
}

// Every public channel in the workspace, joined or not. Much bigger than the joined list (all
// members of every public channel) and empty for guests, so it's only used for unjoined channels.
async function getWorkspacePublicChannelIds(workspaceId: number): Promise<Set<string>> {
    const cached = workspacePublicChannelCache.get(workspaceId)
    if (cached) return cached

    const client = await getCommsClient()
    const channels = await client.workspaces.getPublicChannels(workspaceId)
    const publicIds = new Set(channels.map((ch) => ch.id))
    workspacePublicChannelCache.set(workspaceId, publicIds)
    return publicIds
}

export function clearPublicChannelCache(): void {
    joinedChannelCache.clear()
    workspacePublicChannelCache.clear()
}

export async function assertChannelIsPublic(channelId: string, workspaceId: number): Promise<void> {
    if (includePrivateChannels()) return
    const joined = await getJoinedChannels(workspaceId)
    const isPublic =
        joined.get(channelId) ??
        // getChannels only returns joined channels, so an unjoined one could still be public.
        (await getWorkspacePublicChannelIds(workspaceId)).has(channelId)
    if (!isPublic) {
        throw new CliError('NOT_FOUND', 'This thread belongs to a private channel.', [
            'Use --include-private-channels to access it',
        ])
    }
}

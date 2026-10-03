import type { CommsApi, UnreadThread } from '@doist/comms-sdk'

export type UnreadThreadMap = Map<string, UnreadThread>

/** Normalises the SDK's `{ data, version }` unread response into a Map keyed by thread ID. */
export async function fetchUnreadThreads(
    client: CommsApi,
    workspaceId: number,
): Promise<UnreadThreadMap> {
    const unread = await client.threads.getUnread(workspaceId)
    return new Map(unread.data.map((u) => [u.threadId, u]))
}

/** Per-thread unread state for list output. `hasUnreadMention` is only ever true for an unread thread. */
export function unreadFlags(threadId: string, unreadThreads: UnreadThreadMap) {
    const unread = unreadThreads.get(threadId)
    return { isUnread: unread !== undefined, hasUnreadMention: unread?.directMention ?? false }
}

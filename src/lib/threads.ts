import type { CommsApi, UnreadThread } from '@doist/comms-sdk'

/** Normalises the SDK's `{ data, version }` unread response into a Map keyed by thread ID for O(1) joins. */
export async function fetchUnreadThreads(
    client: CommsApi,
    workspaceId: number,
): Promise<Map<string, UnreadThread>> {
    const unread = await client.threads.getUnread(workspaceId)
    return new Map(unread.data.map((u) => [u.threadId, u]))
}

export async function fetchUnreadThreadIds(
    client: CommsApi,
    workspaceId: number,
): Promise<Set<string>> {
    const unread = await fetchUnreadThreads(client, workspaceId)
    return new Set(unread.keys())
}

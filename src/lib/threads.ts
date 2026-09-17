import type { CommsApi, UnreadThread } from '@doist/comms-sdk'

/** Normalises the SDK's `{ data, version }` unread response into a Map keyed by thread ID. */
export async function fetchUnreadThreads(
    client: CommsApi,
    workspaceId: number,
): Promise<Map<string, UnreadThread>> {
    const unread = await client.threads.getUnread(workspaceId)
    return new Map(unread.data.map((u) => [u.threadId, u]))
}

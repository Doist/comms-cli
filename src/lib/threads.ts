import type { CommsApi } from '@doist/comms-sdk'

/** Normalises the SDK's `{ data, version }` unread response into a Set for O(1) joins. */
export async function fetchUnreadThreadIds(
    client: CommsApi,
    workspaceId: number,
): Promise<Set<string>> {
    const unread = await client.threads.getUnread(workspaceId)
    return new Set(unread.data.map((u) => u.threadId))
}

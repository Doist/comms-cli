import type { Thread } from '@doist/comms-sdk'
import type { MutationOptions } from '../../lib/options.js'
import { runThreadReadStateMutation } from './helpers.js'

export type MarkThreadReadOptions = MutationOptions

type MarkReadStatus = {
    id: string
    isRead: true
}

export async function markThreadRead(
    refs: string[],
    options: MarkThreadReadOptions,
): Promise<void> {
    await runThreadReadStateMutation<MarkReadStatus>(refs, options, {
        verb: 'read',
        plan: async (_client, threadId) => ({
            scope: '',
            isUnchanged: (state) => state.lastReadObjIndex === null,
            status: () => ({ id: threadId, isRead: true }),
            apply: async (client, state) => {
                await client.threads.markRead({
                    id: threadId,
                    objIndex: getLatestObjIndex(state.thread),
                })
                return null
            },
        }),
    })
}

function getLatestObjIndex(thread: Thread): number {
    return Math.max(
        ...[thread.lastComment?.objIndex, thread.lastObjIndex, thread.commentCount, 0]
            .filter((value): value is number => typeof value === 'number')
            .map((value) => Math.max(value, 0)),
    )
}

import type { CommsApi } from '@doist/comms-sdk'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { resolveCommentId } from '../../lib/refs.js'
import { runThreadReadStateMutation } from './helpers.js'

export type MarkThreadUnreadOptions = MutationOptions & { from?: string }

type MarkUnreadStatus = {
    id: string
    isRead: false
    /** Object index of the last comment still read; `-1` when the whole thread is unread. */
    lastReadObjIndex: number
}

/** The API marks the thread body and every comment unread from `-1`. */
const WHOLE_THREAD = -1

export async function markThreadUnread(
    refs: string[],
    options: MarkThreadUnreadOptions,
): Promise<void> {
    const from = options.from
    if (from !== undefined && refs.length > 1) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            '--from applies to a single thread; pass one thread ref when using it.',
        )
    }

    await runThreadReadStateMutation<MarkUnreadStatus>(refs, options, {
        verb: 'unread',
        plan: async (client, threadId) => {
            const target =
                from === undefined
                    ? WHOLE_THREAD
                    : await resolveFromObjIndex(client, threadId, from)
            return {
                scope: from === undefined ? '' : ` from comment ${from}`,
                // Already unread at or before the target: nothing to move.
                isUnchanged: (state) =>
                    state.lastReadObjIndex !== null && state.lastReadObjIndex <= target,
                status: (state, outcome) => ({
                    id: threadId,
                    isRead: false,
                    lastReadObjIndex:
                        outcome === 'unchanged' ? (state.lastReadObjIndex ?? target) : target,
                }),
                apply: async (client) => {
                    await client.threads.markUnread({ id: threadId, objIndex: target })
                    return target
                },
            }
        },
    })
}

/**
 * Turns a comment ref into the `objIndex` to hand `markUnread`: the API takes
 * the last comment that stays READ, so a comment at index N becomes the first
 * unread one when the thread is marked unread from N - 1.
 */
async function resolveFromObjIndex(
    client: CommsApi,
    threadId: string,
    commentRef: string,
): Promise<number> {
    const commentId = resolveCommentId(commentRef)
    const comment = await client.comments.getComment(commentId)

    if (comment.threadId !== threadId) {
        throw new CliError(
            'INVALID_REF',
            `Comment ${commentId} belongs to thread ${comment.threadId}, not ${threadId}.`,
        )
    }
    if (typeof comment.objIndex !== 'number') {
        throw new CliError(
            'INVALID_REF',
            `Comment ${commentId} has no object index; cannot mark unread from it.`,
        )
    }

    return comment.objIndex - 1
}

import type { CommsApi } from '@doist/comms-sdk'
import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson } from '../../lib/output.js'
import { resolveCommentId, resolveThreadId } from '../../lib/refs.js'
import {
    collectThreadRefs,
    loadThreadReadState,
    printReadStateSummary,
    type ReadStateTextStatus,
    threadLabel,
} from './helpers.js'

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
    const rawRefs = await collectThreadRefs(refs)
    if (rawRefs.length === 0) {
        throw new CliError(
            'INVALID_REF',
            'No thread references provided. Pass refs as arguments or pipe them via stdin.',
        )
    }

    if (options.from !== undefined && rawRefs.length > 1) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            '--from applies to a single thread; pass one thread ref when using it.',
        )
    }

    const needsConfirmation = rawRefs.length > 1 && !options.yes && !options.dryRun
    if (options.json && needsConfirmation) {
        throw new CliError(
            'MISSING_YES_FLAG',
            '--yes is required to execute bulk mark-unread in --json mode.',
        )
    }

    const client = await getCommsClient()
    const unreadCache = new Map<number, Map<string, number>>()
    const jsonStatuses: MarkUnreadStatus[] = []
    const textStatuses: ReadStateTextStatus[] = []

    for (const rawRef of rawRefs) {
        const threadId = resolveThreadId(rawRef)
        const loaded = await loadThreadReadState(client, unreadCache, threadId)
        const target =
            options.from === undefined
                ? WHOLE_THREAD
                : await resolveFromObjIndex(client, threadId, options.from)
        const label = threadLabel(loaded.thread)
        const scope = options.from === undefined ? '' : ` from comment ${options.from}`

        // Already unread at or before the target: nothing to move.
        if (loaded.lastReadObjIndex !== null && loaded.lastReadObjIndex <= target) {
            jsonStatuses.push({
                id: threadId,
                isRead: false,
                lastReadObjIndex: loaded.lastReadObjIndex,
            })
            textStatuses.push('unchanged')
            if (!options.json) {
                console.log(`Thread ${label} is already unread${scope}.`)
            }
            continue
        }

        if (needsConfirmation || options.dryRun) {
            jsonStatuses.push({ id: threadId, isRead: false, lastReadObjIndex: target })
            textStatuses.push('preview')
            if (!options.json) {
                const prefix = options.dryRun ? 'Dry run: would' : 'Would'
                console.log(`${prefix} mark unread thread ${label}${scope}.`)
            }
            continue
        }

        await client.threads.markUnread({ id: threadId, objIndex: target })
        unreadCache.get(loaded.thread.workspaceId)?.set(threadId, target)

        jsonStatuses.push({ id: threadId, isRead: false, lastReadObjIndex: target })
        textStatuses.push('changed')
        if (!options.json) {
            console.log(`Thread ${label} marked unread${scope}.`)
        }
    }

    if (options.json && !options.dryRun) {
        console.log(formatJson(jsonStatuses))
        return
    }

    if (!options.json && rawRefs.length > 1) {
        printReadStateSummary(textStatuses)
    }

    if (!options.json && needsConfirmation) {
        console.log('Use --yes to confirm.')
    }
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

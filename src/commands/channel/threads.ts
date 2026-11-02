import { createHash } from 'node:crypto'
import { outputIds, resolveOutputMode } from '@doist/cli-core'
import type { ArchiveFilter, CommsApi, GetThreadsArgs, Thread } from '@doist/comms-sdk'
import chalk from 'chalk'
import { getCommsClient, getCurrentWorkspaceId } from '../../lib/api.js'
import { formatRelativeDate } from '../../lib/dates.js'
import { CliError } from '../../lib/errors.js'
import { isAccessible } from '../../lib/global-args.js'
import type { PaginatedViewOptions } from '../../lib/options.js'
import {
    colors,
    formatPaginatedJson,
    formatPaginatedNdjson,
    type PaginatedOutput,
} from '../../lib/output.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { resolveChannelRef, resolveWorkspaceRef } from '../../lib/refs.js'
import { fetchUnreadThreads, unreadFlags, type UnreadThreadMap } from '../../lib/threads.js'
import { decodeCursor, encodeCursor, type ThreadsCursor } from './helpers.js'

type ChannelThreadsOptions = PaginatedViewOptions & {
    workspace?: string
    unread?: boolean
    archiveFilter?: ArchiveFilter
    cursor?: string
}

type DecoratedThread = Thread & ReturnType<typeof unreadFlags>

function archiveFilterToFlag(filter: ArchiveFilter | undefined): boolean | undefined {
    switch (filter ?? 'active') {
        case 'active':
            return false
        case 'archived':
            return true
        case 'all':
            return undefined
    }
}

function parseDateFilter(value: string, flag: string): number {
    const ts = new Date(value).getTime()
    if (Number.isNaN(ts)) {
        throw new CliError(
            'INVALID_DATE',
            `Invalid ${flag} value: "${value}". Use an ISO-8601 date (e.g. 2026-01-15 or 2026-01-15T09:00:00Z).`,
        )
    }
    return ts
}

// threads/get returns 20 threads unless asked for more, and at most 500 per call.
const MAX_THREADS_PER_CALL = 500

const ceilToSecond = (ts: number) => Math.ceil(ts / 1000) * 1000

/**
 * Pages back through a channel's threads, most recently active first, until `wanted` of them
 * pass `keep` or the channel runs out. Each call after the first starts from the oldest
 * `lastUpdated` so far. The API compares that inclusively and in whole seconds, so threads
 * from that second come back again and are skipped by id. `repeats` is how many threads the
 * first call returns that an earlier page already showed, so it can ask for that many more.
 */
async function fetchChannelThreads(
    client: CommsApi,
    query: Omit<GetThreadsArgs, 'limit'>,
    keep: (thread: Thread) => boolean,
    wanted: number,
    repeats: number,
): Promise<Thread[]> {
    const kept: Thread[] = []
    const seen = new Set<string>()
    let olderThan = query.olderThan
    let limit = Math.min(wanted + repeats, MAX_THREADS_PER_CALL)

    while (kept.length < wanted) {
        const batch = await client.threads.getThreads(
            olderThan ? { ...query, olderThan, limit } : { ...query, limit },
        )
        let added = 0
        for (const thread of batch) {
            if (seen.has(thread.id)) continue
            seen.add(thread.id)
            added++
            if (keep(thread)) kept.push(thread)
        }
        if (batch.length < limit) break
        if (added === 0) {
            // More than a full call of threads share one second, and paging by date can't get
            // past them without leaving some out.
            throw new CliError(
                'PAGINATION_STALLED',
                `threads/get returned a full page with no new threads (channel ${query.channelId}); results would be incomplete`,
            )
        }

        olderThan = new Date(ceilToSecond(new Date(batch[batch.length - 1].lastUpdated).getTime()))
        limit = MAX_THREADS_PER_CALL
    }

    return kept
}

/** A short fingerprint of a set of thread IDs, to tell whether it changed between pages. */
function fingerprint(ids: string[]): string {
    return createHash('sha256')
        .update([...ids].sort().join(','))
        .digest('base64url')
        .slice(0, 16)
}

/** Where the page after `page` starts: past its last thread and anything shown with it. */
function cursorAfter(
    page: Thread[],
    previous: ThreadsCursor | undefined,
    unread: { left: number; set: string } | undefined,
): ThreadsCursor {
    const before = new Date(page[page.length - 1].lastUpdated).getTime()
    const shown = page
        .filter((thread) => new Date(thread.lastUpdated).getTime() === before)
        .map((thread) => thread.id)
    // Threads from one moment can span several pages, so keep the ones earlier pages showed.
    if (previous?.before === before) shown.push(...previous.shown)
    if (!unread) return { before, shown }
    return {
        before,
        shown,
        unreadLeft: Math.max(0, unread.left - page.length),
        unreadSet: unread.set,
    }
}

export async function showChannelThreads(
    channelRef: string,
    workspaceRef: string | undefined,
    options: ChannelThreadsOptions,
): Promise<void> {
    const outputMode = resolveOutputMode(options)
    if (workspaceRef && options.workspace) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot specify workspace both as argument and --workspace flag',
        )
    }

    const sinceTs = options.since ? parseDateFilter(options.since, '--since') : undefined
    const untilTs = options.until ? parseDateFilter(options.until, '--until') : undefined

    let workspaceId: number
    const ref = workspaceRef || options.workspace
    if (ref) {
        const workspace = await resolveWorkspaceRef(ref)
        workspaceId = workspace.id
    } else {
        workspaceId = await getCurrentWorkspaceId()
    }

    const channel = await resolveChannelRef(channelRef, workspaceId)
    await assertChannelIsPublic(channel.id, workspaceId, channel.public)

    const limitNum = options.limit ? parseInt(options.limit, 10) : 50
    const limit = Number.isFinite(limitNum) && limitNum > 0 ? limitNum : 50
    const cursor = decodeCursor(options.cursor)

    const archived = archiveFilterToFlag(options.archiveFilter)
    const client = await getCommsClient()

    const needsUnreadData = outputMode !== 'ids-only' || options.unread
    const unreadThreadsPromise = needsUnreadData
        ? fetchUnreadThreads(client, workspaceId)
        : Promise.resolve<UnreadThreadMap>(new Map())
    // --unread decides which threads fill the page, so the unread set has to come first.
    const unreadOnly = options.unread ? await unreadThreadsPromise : undefined

    // One more than the page needs, to know whether there's a next page.
    // With --unread, no need to look past the channel's last unread thread. The first page
    // counts them and the cursor carries what's left, but only while the channel's unread
    // threads stay the same. Once they change, later pages can't trust the count and read on.
    let unread: { left: number; set: string } | undefined
    if (unreadOnly) {
        const unreadIds = [...unreadOnly.values()]
            .filter((u) => u.channelId === channel.id)
            .map((u) => u.threadId)
        const set = fingerprint(unreadIds)
        if (!cursor) {
            unread = { left: unreadIds.length, set }
        } else if (cursor.unreadSet === set && cursor.unreadLeft !== undefined) {
            unread = { left: cursor.unreadLeft, set }
        }
    }
    const wanted = Math.min(limit + 1, unread?.left ?? Infinity)

    // The API's bounds are whole seconds and inclusive, so they can let in a little extra
    // around --since, --until and the cursor. The exact filters still run on each thread.
    const shownBefore = new Set(cursor?.shown)
    const keep = (thread: Thread) => {
        const lastUpdated = new Date(thread.lastUpdated).getTime()
        return (
            (!cursor ||
                lastUpdated < cursor.before ||
                (lastUpdated === cursor.before && !shownBefore.has(thread.id))) &&
            (!unreadOnly || unreadOnly.has(thread.id)) &&
            (sinceTs === undefined || lastUpdated >= sinceTs) &&
            (untilTs === undefined || lastUpdated < untilTs)
        )
    }

    // Start where the previous page stopped, or at --until, whichever is older.
    const startTs = Math.min(cursor?.before ?? Infinity, untilTs ?? Infinity)

    const [threads, unreadThreads] = await Promise.all([
        fetchChannelThreads(
            client,
            {
                workspaceId,
                channelId: channel.id,
                ...(archived === undefined ? {} : { archived }),
                ...(sinceTs === undefined ? {} : { newerThan: new Date(sinceTs) }),
                ...(startTs === Infinity ? {} : { olderThan: new Date(ceilToSecond(startTs)) }),
            },
            keep,
            wanted,
            cursor?.shown.length ?? 0,
        ),
        unreadThreadsPromise,
    ])

    threads.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())

    const page = threads.slice(0, limit)
    const nextCursor =
        threads.length > limit ? encodeCursor(cursorAfter(page, cursor, unread)) : null

    if (outputMode === 'ids-only') {
        await outputIds(
            page,
            (thread) => thread.id,
            nextCursor ? `More threads available. Use --cursor ${nextCursor}` : '',
        )
        return
    }

    const decoratedPage: DecoratedThread[] = page.map((thread) => ({
        ...thread,
        ...unreadFlags(thread.id, unreadThreads),
    }))
    const paginated: PaginatedOutput<DecoratedThread> = {
        results: decoratedPage,
        nextCursor,
    }

    if (outputMode === 'json') {
        console.log(formatPaginatedJson(paginated, 'thread', options.full))
        return
    }

    if (outputMode === 'ndjson') {
        console.log(formatPaginatedNdjson(paginated, 'thread', options.full))
        return
    }

    if (decoratedPage.length === 0) {
        console.log(`No threads in #${channel.name}.`)
        return
    }

    console.log(chalk.bold.blue(`[${channel.name}]`))
    console.log('')

    for (const thread of decoratedPage) {
        const title = thread.isUnread ? chalk.bold(thread.title) : thread.title
        const time = colors.timestamp(formatRelativeDate(thread.lastUpdated))
        const unreadBadge = thread.isUnread ? chalk.blue(isAccessible() ? ' (unread)' : ' *') : ''

        console.log(`  ${title}${unreadBadge}`)
        console.log(`    ${time}  ${colors.timestamp(`id:${thread.id}`)}`)
        console.log(`    ${colors.url(thread.url)}`)
        console.log('')
    }

    if (nextCursor) {
        console.log(colors.timestamp(`More threads available. Use --cursor ${nextCursor}`))
    }
}

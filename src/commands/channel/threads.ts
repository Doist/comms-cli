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
import { decodeCursor, encodeCursor } from './helpers.js'

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
 * from that second come back again and are skipped by id.
 */
async function fetchChannelThreads(
    client: CommsApi,
    query: Omit<GetThreadsArgs, 'limit'>,
    keep: (thread: Thread) => boolean,
    wanted: number,
): Promise<Thread[]> {
    const kept: Thread[] = []
    const seen = new Set<string>()
    let olderThan = query.olderThan
    let limit = Math.min(wanted, MAX_THREADS_PER_CALL)

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

        const oldest = ceilToSecond(new Date(batch[batch.length - 1].lastUpdated).getTime())
        // If a whole call came back from one second, asking for that second again would loop
        // forever, so step past it.
        olderThan = new Date(added > 0 ? oldest : oldest - 1000)
        limit = MAX_THREADS_PER_CALL
    }

    return kept
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
    await assertChannelIsPublic(channel.id, workspaceId)

    const limitNum = options.limit ? parseInt(options.limit, 10) : 50
    const limit = Number.isFinite(limitNum) && limitNum > 0 ? limitNum : 50
    const offset = decodeCursor(options.cursor)

    const archived = archiveFilterToFlag(options.archiveFilter)
    const client = await getCommsClient()

    const needsUnreadData = outputMode !== 'ids-only' || options.unread
    const unreadThreadsPromise = needsUnreadData
        ? fetchUnreadThreads(client, workspaceId)
        : Promise.resolve<UnreadThreadMap>(new Map())
    // --unread decides which threads fill the page, so the unread set has to come first.
    const unreadOnly = options.unread ? await unreadThreadsPromise : undefined

    // One more than the page needs, to know whether there's a next page.
    let wanted = offset + limit + 1
    if (unreadOnly) {
        const unreadHere = [...unreadOnly.values()].filter((u) => u.channelId === channel.id)
        wanted = Math.min(wanted, unreadHere.length)
    }

    // The API's bounds are whole seconds and inclusive, so they can let in a little extra
    // around --since and --until. The exact filters still run on each thread.
    const keep = (thread: Thread) => {
        const lastUpdated = new Date(thread.lastUpdated).getTime()
        return (
            (!unreadOnly || unreadOnly.has(thread.id)) &&
            (sinceTs === undefined || lastUpdated >= sinceTs) &&
            (untilTs === undefined || lastUpdated < untilTs)
        )
    }

    const [threads, unreadThreads] = await Promise.all([
        fetchChannelThreads(
            client,
            {
                workspaceId,
                channelId: channel.id,
                ...(archived === undefined ? {} : { archived }),
                ...(sinceTs === undefined ? {} : { newerThan: new Date(sinceTs) }),
                ...(untilTs === undefined ? {} : { olderThan: new Date(ceilToSecond(untilTs)) }),
            },
            keep,
            wanted,
        ),
        unreadThreadsPromise,
    ])

    threads.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())

    const page = threads.slice(offset, offset + limit)
    const nextCursor = offset + limit < threads.length ? encodeCursor(offset + limit) : null

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

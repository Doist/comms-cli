import type { Channel } from '@doist/comms-sdk'
import { getCommsClient } from '../../lib/api.js'
import { formatRelativeDate } from '../../lib/dates.js'
import { CliError } from '../../lib/errors.js'
import { includePrivateChannels } from '../../lib/global-args.js'
import type { ViewOptions } from '../../lib/options.js'
import { colors, formatJson, formatNdjson, printEmpty } from '../../lib/output.js'
import { resolveChannelWorkspaceId } from './helpers.js'

const CHANNEL_SCOPES = ['joined', 'public', 'discoverable'] as const
const CHANNEL_STATES = ['active', 'all', 'archived'] as const

type ChannelScope = (typeof CHANNEL_SCOPES)[number]
type ChannelState = (typeof CHANNEL_STATES)[number]
type ListedChannel = Channel & { joined?: boolean }

const DEFAULT_CONCURRENCY = 8
const MAX_CONCURRENCY = 16

export type ChannelActivityOptions = ViewOptions & {
    workspace?: string
    scope?: string
    state?: string
    concurrency?: string
    inactiveSince?: string
}

type ChannelActivity = {
    id: string
    name: string
    archived: boolean
    public: boolean
    joined?: boolean
    created: Date
    /** Newest `thread.lastUpdated` across all threads, or null when empty. */
    lastActivityAt: Date | null
    threadCount: number
    /** Set when the per-channel thread probe failed. */
    error?: string
}

function parseChannelScope(scope: string | undefined): ChannelScope {
    const resolved = scope ?? 'public'
    if ((CHANNEL_SCOPES as readonly string[]).includes(resolved)) {
        return resolved as ChannelScope
    }

    throw new CliError(
        'INVALID_SCOPE',
        `Invalid channel scope: ${resolved}. Use one of: ${CHANNEL_SCOPES.join(', ')}.`,
    )
}

function parseChannelState(state: string | undefined): ChannelState {
    const resolved = state ?? 'active'
    if ((CHANNEL_STATES as readonly string[]).includes(resolved)) {
        return resolved as ChannelState
    }

    throw new CliError(
        'INVALID_STATE',
        `Invalid channel state: ${resolved}. Use one of: ${CHANNEL_STATES.join(', ')}.`,
    )
}

function parseConcurrency(value: string | undefined): number {
    if (value === undefined) return DEFAULT_CONCURRENCY
    const n = Number.parseInt(value, 10)
    if (!Number.isFinite(n) || n < 1) {
        throw new CliError('INVALID_CONCURRENCY', `Invalid --concurrency value: "${value}".`)
    }
    return Math.min(n, MAX_CONCURRENCY)
}

function parseInactiveSince(value: string | undefined): number | undefined {
    if (value === undefined) return undefined
    const ts = new Date(value).getTime()
    if (Number.isNaN(ts)) {
        throw new CliError(
            'INVALID_DATE',
            `Invalid --inactive-since value: "${value}". Use an ISO-8601 date (e.g. 2026-04-16).`,
        )
    }
    return ts
}

function matchesChannelState(channel: Channel, state: ChannelState): boolean {
    switch (state) {
        case 'active':
            return !channel.archived
        case 'all':
            return true
        case 'archived':
            return channel.archived
    }
}

/**
 * Map `items` through `fn` with at most `limit` in flight, preserving order.
 */
async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = Array.from({ length: items.length })
    let cursor = 0
    const worker = async () => {
        while (cursor < items.length) {
            const index = cursor++
            results[index] = await fn(items[index], index)
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    return results
}

async function resolveChannelSet(
    workspaceId: number,
    scope: ChannelScope,
    state: ChannelState,
): Promise<ListedChannel[]> {
    const client = await getCommsClient()

    if (scope === 'joined') {
        const channels =
            state === 'all'
                ? await client.channels.getChannels({ workspaceId })
                : await client.channels.getChannels({
                      workspaceId,
                      archived: state === 'archived',
                  })
        return includePrivateChannels() ? channels : channels.filter((c) => c.public)
    }

    const [joinedChannels, publicChannels] = await Promise.all([
        client.channels.getChannels({ workspaceId }),
        client.workspaces.getPublicChannels(workspaceId),
    ])
    const joinedIds = new Set(joinedChannels.map((c) => c.id))

    return publicChannels
        .filter((c) => matchesChannelState(c, state))
        .filter((c) => scope === 'public' || !joinedIds.has(c.id))
        .map((c) => ({ ...c, joined: joinedIds.has(c.id) }))
}

/**
 * A channel's last activity is the newest `lastUpdated` across all its threads
 * (omitting the `archived` filter returns active + done threads, so a channel
 * whose recent threads were marked done still counts as active). Channels with
 * no threads return null and fall back to `created` for inactivity decisions.
 */
async function probeChannelActivity(channel: ListedChannel): Promise<ChannelActivity> {
    const base: ChannelActivity = {
        id: channel.id,
        name: channel.name,
        archived: channel.archived,
        public: channel.public,
        ...(channel.joined !== undefined ? { joined: channel.joined } : {}),
        created: channel.created,
        lastActivityAt: null,
        threadCount: 0,
    }

    try {
        const client = await getCommsClient()
        const threads = await client.threads.getThreads({
            workspaceId: channel.workspaceId,
            channelId: channel.id,
        })
        let newest = 0
        for (const t of threads) {
            const ts = new Date(t.lastUpdated).getTime()
            if (ts > newest) newest = ts
        }
        return {
            ...base,
            threadCount: threads.length,
            lastActivityAt: newest > 0 ? new Date(newest) : null,
        }
    } catch (error) {
        return { ...base, error: error instanceof Error ? error.message : String(error) }
    }
}

/** Effective activity timestamp for filtering: last thread, else channel creation. */
function effectiveActivityTs(activity: ChannelActivity): number {
    if (activity.lastActivityAt) return activity.lastActivityAt.getTime()
    return new Date(activity.created).getTime()
}

function formatActivityLine(activity: ChannelActivity): string {
    const id = colors.timestamp(`id:${activity.id}`)
    const name = colors.channel(activity.name)
    const archived = activity.archived ? colors.timestamp(' (archived)') : ''
    const joined = activity.joined === false ? colors.timestamp(' [not joined]') : ''
    const last = activity.error
        ? colors.timestamp(' error: ' + activity.error)
        : activity.lastActivityAt
          ? `  last: ${colors.timestamp(formatRelativeDate(activity.lastActivityAt))}`
          : `  last: ${colors.timestamp('never')}`
    const count = colors.timestamp(` (${activity.threadCount} threads)`)
    return `${id}  ${name}${joined}${archived}${last}${count}`
}

export async function showChannelActivity(
    workspaceRef: string | undefined,
    options: ChannelActivityOptions,
): Promise<void> {
    if (workspaceRef && options.workspace) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot specify workspace both as argument and --workspace flag',
        )
    }

    const scope = parseChannelScope(options.scope)
    const state = parseChannelState(options.state)
    const concurrency = parseConcurrency(options.concurrency)
    const inactiveSinceTs = parseInactiveSince(options.inactiveSince)
    const workspaceId = await resolveChannelWorkspaceId(workspaceRef || options.workspace)

    const channels = await resolveChannelSet(workspaceId, scope, state)

    if (channels.length === 0) {
        printEmpty({ options, type: 'channel', message: 'No channels found.' })
        return
    }

    let activity = await mapWithConcurrency(channels, concurrency, probeChannelActivity)

    if (inactiveSinceTs !== undefined) {
        activity = activity.filter((a) => effectiveActivityTs(a) < inactiveSinceTs)
    }

    // Newest activity first; channels with no activity (fall back to created) sort by that.
    activity.sort((a, b) => effectiveActivityTs(b) - effectiveActivityTs(a))

    if (options.json) {
        console.log(formatJson(activity))
        return
    }

    if (options.ndjson) {
        console.log(formatNdjson(activity))
        return
    }

    if (activity.length === 0) {
        printEmpty({ options, type: 'channel', message: 'No channels match the filter.' })
        return
    }

    for (const a of activity) {
        console.log(formatActivityLine(a))
    }
}

import type { CommsApi, Thread } from '@doist/comms-sdk'
import chalk from 'chalk'
import { getCommsClient, getWorkspaceGroups, getWorkspaceUsers } from '../../lib/api.js'
import { formatRelativeDate } from '../../lib/dates.js'
import { CliError } from '../../lib/errors.js'
import { isAccessible } from '../../lib/global-args.js'
import { readStdinToEnd } from '../../lib/input.js'
import { renderMarkdown } from '../../lib/markdown.js'
import type { MutationOptions } from '../../lib/options.js'
import { colors, formatJson, pluralize } from '../../lib/output.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { partitionNotifyIds, resolveThreadId } from '../../lib/refs.js'

export function printSeparator(label: string): void {
    const totalWidth = 60
    const labelWithPadding = ` ${label} `
    const remainingWidth = totalWidth - labelWithPadding.length
    const leftWidth = Math.floor(remainingWidth / 2)
    const rightWidth = remainingWidth - leftWidth
    const dashChar = isAccessible() ? '-' : '─'
    const line = chalk.dim(
        dashChar.repeat(leftWidth) + labelWithPadding + dashChar.repeat(rightWidth),
    )
    console.log('')
    console.log(line)
    console.log('')
}

export interface CommentLike {
    id: string
    creator: number
    posted: Date
    content: string
}

export async function printComment(
    comment: CommentLike,
    userMap: Map<number, string>,
    raw: boolean,
): Promise<void> {
    const author = colors.author(userMap.get(comment.creator) || `user:${comment.creator}`)
    const time = colors.timestamp(formatRelativeDate(comment.posted))
    console.log(`${author}  ${time}  ${colors.timestamp(`id:${comment.id}`)}`)
    console.log(raw ? comment.content : await renderMarkdown(comment.content))
    console.log('')
}

export type NamedEntity = { id: number | string; name: string }

export interface NotifiedInfo {
    users: NamedEntity[]
    groups: NamedEntity[]
}

export interface ResolvedNotify {
    recipients: number[] | undefined
    groups: string[] | undefined
    notified: NotifiedInfo
}

export async function resolveNotifyIds(
    ids: string[],
    workspaceId: number,
): Promise<ResolvedNotify> {
    const workspaceGroups = await getWorkspaceGroups(workspaceId)
    const groupIdSet = new Set(workspaceGroups.map((g) => g.id))
    const partitioned = partitionNotifyIds(ids, groupIdSet)
    const recipients = partitioned.userIds.length > 0 ? partitioned.userIds : undefined
    const groups = partitioned.groupIds.length > 0 ? partitioned.groupIds : undefined
    const workspaceUserList = await getWorkspaceUsers(workspaceId)
    const userMap = new Map(workspaceUserList.map((u) => [u.id, u.fullName]))
    const groupMap = new Map(workspaceGroups.map((g) => [g.id, g.name]))
    const notified: NotifiedInfo = {
        users: (recipients ?? []).map((id) => ({ id, name: userMap.get(id) ?? `user:${id}` })),
        groups: (groups ?? []).map((id) => ({ id, name: groupMap.get(id) ?? `group:${id}` })),
    }
    return { recipients, groups, notified }
}

export function formatNotifyLabel(items: NamedEntity[]): string {
    return items.map((i) => `${i.name} (${i.id})`).join(', ')
}

// Shared by `mark-read` and `mark-unread`: the bulk-ref loop, the per-workspace
// unread lookup, confirmation, and output. Each verb supplies a per-thread plan.

export type ReadStateTextStatus = 'changed' | 'preview' | 'unchanged'

export type ThreadReadState = {
    thread: Thread
    /**
     * Object index of the last comment the user has read, or `null` when the
     * thread is fully read (absent from the workspace's unread list). `-1`
     * means nothing has been read, including the thread body.
     */
    lastReadObjIndex: number | null
}

export type ReadStatePlan<Status> = {
    /** Appended to messages, e.g. `' from comment X'`; empty for the whole thread. */
    scope: string
    isUnchanged(state: ThreadReadState): boolean
    /** JSON row; `outcome` is `'unchanged'` when nothing needs to move. */
    status(state: ThreadReadState, outcome: 'planned' | 'unchanged'): Status
    /** Performs the mutation and returns the thread's new `lastReadObjIndex`. */
    apply(client: CommsApi, state: ThreadReadState): Promise<number | null>
}

export type ReadStateMutation<Status> = {
    verb: 'read' | 'unread'
    /**
     * Builds the per-thread plan. Runs before the unread lookup so an invalid
     * option (a bad `--from` ref) fails without a workspace-wide request.
     */
    plan(client: CommsApi, threadId: string): Promise<ReadStatePlan<Status>>
}

export async function runThreadReadStateMutation<Status extends { id: string }>(
    refs: string[],
    options: MutationOptions,
    mutation: ReadStateMutation<Status>,
): Promise<void> {
    const rawRefs = await collectThreadRefs(refs)
    if (rawRefs.length === 0) {
        throw new CliError(
            'INVALID_REF',
            'No thread references provided. Pass refs as arguments or pipe them via stdin.',
        )
    }

    const needsConfirmation = rawRefs.length > 1 && !options.yes && !options.dryRun
    if (options.json && needsConfirmation) {
        throw new CliError(
            'MISSING_YES_FLAG',
            `--yes is required to execute bulk mark-${mutation.verb} in --json mode.`,
        )
    }

    const client = await getCommsClient()
    const unreadCache = new Map<number, Map<string, number>>()
    const jsonStatuses: Status[] = []
    const textStatuses: ReadStateTextStatus[] = []

    for (const rawRef of rawRefs) {
        const threadId = resolveThreadId(rawRef)
        const plan = await mutation.plan(client, threadId)
        const state = await loadThreadReadState(client, unreadCache, threadId)
        const label = threadLabel(state.thread)

        if (plan.isUnchanged(state)) {
            jsonStatuses.push(plan.status(state, 'unchanged'))
            textStatuses.push('unchanged')
            if (!options.json) {
                console.log(`Thread ${label} is already ${mutation.verb}${plan.scope}.`)
            }
            continue
        }

        if (needsConfirmation || options.dryRun) {
            jsonStatuses.push(plan.status(state, 'planned'))
            textStatuses.push('preview')
            if (!options.json) {
                const prefix = options.dryRun ? 'Dry run: would' : 'Would'
                console.log(`${prefix} mark ${mutation.verb} thread ${label}${plan.scope}.`)
            }
            continue
        }

        const lastReadObjIndex = await plan.apply(client, state)
        const unreadByThread = unreadCache.get(state.thread.workspaceId)
        if (lastReadObjIndex === null) {
            unreadByThread?.delete(threadId)
        } else {
            unreadByThread?.set(threadId, lastReadObjIndex)
        }

        jsonStatuses.push(plan.status(state, 'planned'))
        textStatuses.push('changed')
        if (!options.json) {
            console.log(`Thread ${label} marked ${mutation.verb}${plan.scope}.`)
        }
    }

    if (options.json) {
        console.log(
            formatJson(
                options.dryRun
                    ? jsonStatuses.map((status) => ({ ...status, dryRun: true }))
                    : jsonStatuses,
            ),
        )
        return
    }

    if (rawRefs.length > 1) {
        printReadStateSummary(textStatuses)
    }

    if (needsConfirmation) {
        console.log('Use --yes to confirm.')
    }
}

async function collectThreadRefs(refs: string[]): Promise<string[]> {
    const inlineRefs = refs.map((ref) => ref.trim()).filter(Boolean)

    const stdinContent = await readStdinToEnd()
    if (!stdinContent) return inlineRefs

    const stdinRefs = stdinContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))

    return [...inlineRefs, ...stdinRefs]
}

/**
 * Loads a thread and its unread position. `unreadCache` maps a workspace id to
 * its unread threads (`threadId` -> last read `objIndex`) so bulk runs fetch
 * the unread list once per workspace.
 */
async function loadThreadReadState(
    client: CommsApi,
    unreadCache: Map<number, Map<string, number>>,
    threadId: string,
): Promise<ThreadReadState> {
    const thread = await client.threads.getThread(threadId)
    await assertChannelIsPublic(thread.channelId, thread.workspaceId)

    let unreadByThread = unreadCache.get(thread.workspaceId)
    if (!unreadByThread) {
        const unread = await client.threads.getUnread(thread.workspaceId)
        unreadByThread = new Map(
            unread.data.map((unreadThread) => [unreadThread.threadId, unreadThread.objIndex]),
        )
        unreadCache.set(thread.workspaceId, unreadByThread)
    }

    return { thread, lastReadObjIndex: unreadByThread.get(thread.id) ?? null }
}

export function threadLabel(thread: Pick<Thread, 'id' | 'title'>): string {
    return `${thread.title} (${thread.id})`
}

function printReadStateSummary(statuses: ReadStateTextStatus[]): void {
    const summary = [
        summarizeStatus(statuses, 'changed'),
        summarizeStatus(statuses, 'unchanged'),
        summarizeStatus(statuses, 'preview'),
    ].filter(Boolean)

    console.log('')
    console.log(`Summary: ${summary.join(', ')}`)
}

function summarizeStatus(
    statuses: ReadStateTextStatus[],
    status: ReadStateTextStatus,
): string | null {
    const count = statuses.filter((value) => value === status).length
    if (count === 0) {
        return null
    }

    const noun = status === 'preview' ? pluralize(count, 'preview') : pluralize(count, 'thread')
    return status === 'preview' ? `${count} ${noun}` : `${count} ${status} ${noun}`
}

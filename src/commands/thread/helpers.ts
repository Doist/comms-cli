import type { CommsApi, Thread } from '@doist/comms-sdk'
import chalk from 'chalk'
import { getWorkspaceGroups, getWorkspaceUsers } from '../../lib/api.js'
import { formatRelativeDate } from '../../lib/dates.js'
import { isAccessible } from '../../lib/global-args.js'
import { readStdinToEnd } from '../../lib/input.js'
import { renderMarkdown } from '../../lib/markdown.js'
import { colors, pluralize } from '../../lib/output.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { partitionNotifyIds } from '../../lib/refs.js'

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

// Shared by `mark-read` and `mark-unread`: bulk ref collection, the per-workspace
// unread lookup, and the text summary.

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

export async function collectThreadRefs(refs: string[]): Promise<string[]> {
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
 * the unread list once per workspace; callers update it after mutating.
 */
export async function loadThreadReadState(
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

export function getLatestObjIndex(thread: Thread): number {
    return Math.max(
        ...[thread.lastComment?.objIndex, thread.lastObjIndex, thread.commentCount, 0]
            .filter((value): value is number => typeof value === 'number')
            .map((value) => Math.max(value, 0)),
    )
}

export function threadLabel(thread: Thread): string {
    return `${thread.title} (${thread.id})`
}

export function printReadStateSummary(statuses: ReadStateTextStatus[]): void {
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

import type { CommsApi, Thread } from '@doist/comms-sdk'
import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { readStdinToEnd } from '../../lib/input.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, pluralize } from '../../lib/output.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { resolveThreadId } from '../../lib/refs.js'

export type MarkThreadReadOptions = MutationOptions

type LoadedThread = {
    thread: Thread
    isUnread: boolean
}

type MarkReadStatus = {
    id: string
    isRead: true
}

type TextStatus = 'changed' | 'preview' | 'unchanged'

export async function markThreadRead(
    refs: string[],
    options: MarkThreadReadOptions,
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
            '--yes is required to execute bulk mark-read in --json mode.',
        )
    }

    const client = await getCommsClient()
    const unreadCache = new Map<number, Set<string>>()
    const jsonStatuses: MarkReadStatus[] = []
    const textStatuses: TextStatus[] = []

    for (const rawRef of rawRefs) {
        const threadId = resolveThreadId(rawRef)
        const loaded = await loadThread(client, unreadCache, threadId)

        if (!loaded.isUnread) {
            jsonStatuses.push({ id: threadId, isRead: true })
            textStatuses.push('unchanged')
            if (!options.json) {
                console.log(`Thread ${threadLabel(loaded.thread)} is already read.`)
            }
            continue
        }

        if (needsConfirmation || options.dryRun) {
            jsonStatuses.push({ id: threadId, isRead: true })
            textStatuses.push('preview')
            if (!options.json) {
                const prefix = options.dryRun ? 'Dry run: would' : 'Would'
                console.log(`${prefix} mark read thread ${threadLabel(loaded.thread)}.`)
            }
            continue
        }

        await client.threads.markRead({
            id: threadId,
            objIndex: getLatestObjIndex(loaded.thread),
        })
        unreadCache.get(loaded.thread.workspaceId)?.delete(threadId)

        jsonStatuses.push({ id: threadId, isRead: true })
        textStatuses.push('changed')
        if (!options.json) {
            console.log(`Thread ${threadLabel(loaded.thread)} marked read.`)
        }
    }

    if (options.json && !options.dryRun) {
        console.log(formatJson(jsonStatuses))
        return
    }

    if (!options.json && rawRefs.length > 1) {
        printSummary(textStatuses)
    }

    if (!options.json && needsConfirmation) {
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

async function loadThread(
    client: CommsApi,
    unreadCache: Map<number, Set<string>>,
    threadId: string,
): Promise<LoadedThread> {
    const thread = await client.threads.getThread(threadId)
    await assertChannelIsPublic(thread.channelId, thread.workspaceId)

    let unreadIds = unreadCache.get(thread.workspaceId)
    if (!unreadIds) {
        const unread = await client.threads.getUnread(thread.workspaceId)
        unreadIds = new Set(unread.data.map((unreadThread) => unreadThread.threadId))
        unreadCache.set(thread.workspaceId, unreadIds)
    }

    return { thread, isUnread: unreadIds.has(thread.id) }
}

function getLatestObjIndex(thread: Thread): number {
    return Math.max(
        ...[thread.lastComment?.objIndex, thread.lastObjIndex, thread.commentCount, 0]
            .filter((value): value is number => typeof value === 'number')
            .map((value) => Math.max(value, 0)),
    )
}

function threadLabel(thread: Thread): string {
    return `${thread.title} (${thread.id})`
}

function printSummary(statuses: TextStatus[]): void {
    const summary = [
        summarizeStatus(statuses, 'changed'),
        summarizeStatus(statuses, 'unchanged'),
        summarizeStatus(statuses, 'preview'),
    ].filter(Boolean)

    console.log('')
    console.log(`Summary: ${summary.join(', ')}`)
}

function summarizeStatus(statuses: TextStatus[], status: TextStatus): string | null {
    const count = statuses.filter((value) => value === status).length
    if (count === 0) {
        return null
    }

    const noun = status === 'preview' ? pluralize(count, 'preview') : pluralize(count, 'thread')
    return status === 'preview' ? `${count} ${noun}` : `${count} ${status} ${noun}`
}

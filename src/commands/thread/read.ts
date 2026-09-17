import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson } from '../../lib/output.js'
import { resolveThreadId } from '../../lib/refs.js'
import {
    collectThreadRefs,
    getLatestObjIndex,
    loadThreadReadState,
    printReadStateSummary,
    type ReadStateTextStatus,
    threadLabel,
} from './helpers.js'

export type MarkThreadReadOptions = MutationOptions

type MarkReadStatus = {
    id: string
    isRead: true
}

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
    const unreadCache = new Map<number, Map<string, number>>()
    const jsonStatuses: MarkReadStatus[] = []
    const textStatuses: ReadStateTextStatus[] = []

    for (const rawRef of rawRefs) {
        const threadId = resolveThreadId(rawRef)
        const loaded = await loadThreadReadState(client, unreadCache, threadId)

        if (loaded.lastReadObjIndex === null) {
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
        printReadStateSummary(textStatuses)
    }

    if (!options.json && needsConfirmation) {
        console.log('Use --yes to confirm.')
    }
}

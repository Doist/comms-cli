import type { CommsApi } from '@doist/comms-sdk'
import chalk from 'chalk'
import { buildUserNameMap, getCommsClient } from '../../lib/api.js'
import { formatRelativeDate } from '../../lib/dates.js'
import { renderMarkdown } from '../../lib/markdown.js'
import { toDate, type PaginatedViewOptions } from '../../lib/options.js'
import { colors, formatJson, pluralize } from '../../lib/output.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { extractId, parseRef, resolveThreadId } from '../../lib/refs.js'
import { printComment, printSeparator } from './helpers.js'

type ViewOptions = PaginatedViewOptions & {
    comment?: string
    unread?: boolean
    context?: string
}

async function viewSingleComment(
    client: CommsApi,
    threadId: string,
    commentId: string,
    options: ViewOptions,
): Promise<void> {
    const [thread, comment] = await Promise.all([
        client.threads.getThread(threadId),
        client.comments.getComment(commentId),
    ])

    const [channel, userMap] = await Promise.all([
        client.channels.getChannel(thread.channelId),
        buildUserNameMap(thread.workspaceId, client),
    ])

    if (options.json) {
        const output = {
            ...comment,
            creatorName: userMap.get(comment.creator),
            channelName: channel.name,
            threadTitle: thread.title,
        }
        console.log(formatJson(output, undefined, options.full))
        return
    }

    if (options.ndjson) {
        console.log(
            JSON.stringify({
                type: 'comment',
                ...comment,
                creatorName: userMap.get(comment.creator),
            }),
        )
        return
    }

    console.log(chalk.bold(thread.title))
    console.log(colors.channel(`[${channel.name}]`))
    console.log('')
    await printComment(comment, userMap, options.raw ?? false)
}

export async function viewThread(ref: string, options: ViewOptions): Promise<void> {
    const parsed = parseRef(ref)
    const threadId = resolveThreadId(ref)
    const urlCommentId = parsed.type === 'url' ? parsed.parsed.commentId : undefined
    let commentId: string | undefined
    if (options.comment !== undefined) {
        commentId = extractId(options.comment)
    } else {
        commentId = urlCommentId
    }
    const client = await getCommsClient()

    if (commentId !== undefined) {
        return viewSingleComment(client, threadId, commentId, options)
    }

    const limit = options.limit ? parseInt(options.limit, 10) : 50

    const [thread, comments] = await Promise.all([
        client.threads.getThread(threadId),
        client.comments.getComments({
            threadId,
            newerThan: toDate(options.since),
            olderThan: toDate(options.until),
            limit,
        }),
    ])

    await assertChannelIsPublic(thread.channelId, thread.workspaceId)

    // Resolve unread state and filter comments before any output
    let displayComments = comments
    let contextComments: typeof comments = []
    let lastReadObjIndex = 0
    let hasUnread = false

    if (options.unread) {
        const unread = await client.threads.getUnread(thread.workspaceId)
        const threadUnread = unread.data.find((u) => u.threadId === threadId)

        if (threadUnread) {
            lastReadObjIndex = threadUnread.objIndex
            const contextSize = options.context ? parseInt(options.context, 10) : 0
            displayComments = comments.filter((c) => (c.objIndex ?? 0) > lastReadObjIndex)
            contextComments = comments
                .filter((c) => (c.objIndex ?? 0) <= lastReadObjIndex)
                .sort((a, b) => (b.objIndex ?? 0) - (a.objIndex ?? 0))
                .slice(0, contextSize)
                .reverse()
            hasUnread = displayComments.length > 0
        } else {
            displayComments = []
            hasUnread = false
        }
    }

    const [channel, userMap] = await Promise.all([
        client.channels.getChannel(thread.channelId),
        buildUserNameMap(thread.workspaceId, client),
    ])

    if (options.json) {
        const output = {
            thread: {
                ...thread,
                channelName: channel.name,
                creatorName: userMap.get(thread.creator),
            },
            comments: displayComments.map((c) => ({
                ...c,
                creatorName: userMap.get(c.creator),
            })),
        }
        console.log(formatJson(output, undefined, options.full))
        return
    }

    if (options.ndjson) {
        const threadOutput = {
            type: 'thread',
            ...thread,
            channelName: channel.name,
            creatorName: userMap.get(thread.creator),
        }
        console.log(JSON.stringify(threadOutput))
        for (const c of displayComments) {
            console.log(
                JSON.stringify({ type: 'comment', ...c, creatorName: userMap.get(c.creator) }),
            )
        }
        return
    }

    console.log(chalk.bold(thread.title))
    console.log(colors.channel(`[${channel.name}]`))
    console.log('')

    if (options.unread) {
        const creatorName = userMap.get(thread.creator) || `user:${thread.creator}`
        console.log(
            `${colors.author(creatorName)}  ${colors.timestamp(formatRelativeDate(thread.posted))}  ${chalk.dim('(original post)')}`,
        )
        console.log('')
        console.log(options.raw ? thread.content : await renderMarkdown(thread.content))

        if (!hasUnread) {
            console.log('')
            console.log('No unread comments.')
            return
        }

        if (contextComments.length > 0) {
            const firstContextIndex = contextComments[0].objIndex ?? 0
            const skippedCount = firstContextIndex - 1
            if (skippedCount > 0) {
                printSeparator(`${skippedCount} ${pluralize(skippedCount, 'comment')} skipped`)
            } else {
                console.log('')
            }
            for (const comment of contextComments) {
                await printComment(comment, userMap, options.raw ?? false)
            }
        } else if (lastReadObjIndex > 0) {
            printSeparator(`${lastReadObjIndex} ${pluralize(lastReadObjIndex, 'comment')} skipped`)
        }

        printSeparator(`UNREAD (${displayComments.length} new)`)

        for (const comment of displayComments) {
            await printComment(comment, userMap, options.raw ?? false)
        }
    } else {
        const creatorName = userMap.get(thread.creator) || `user:${thread.creator}`
        console.log(
            `${colors.author(creatorName)}  ${colors.timestamp(formatRelativeDate(thread.posted))}`,
        )
        console.log('')
        console.log(options.raw ? thread.content : await renderMarkdown(thread.content))
        console.log('')

        if (comments.length > 0) {
            console.log(
                chalk.dim(`--- ${comments.length} ${pluralize(comments.length, 'comment')} ---`),
            )
            console.log('')

            for (const comment of comments) {
                await printComment(comment, userMap, options.raw ?? false)
            }
        }
    }
}

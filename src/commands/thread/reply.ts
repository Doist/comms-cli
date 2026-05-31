import chalk from 'chalk'
import { getCommsClient } from '../../lib/api.js'
import { uploadAttachments, validateAttachmentFiles } from '../../lib/attachments.js'
import { CliError } from '../../lib/errors.js'
import { openEditor, readStdin } from '../../lib/input.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { parseNotifyIdRefs, resolveThreadId } from '../../lib/refs.js'
import { type ResolvedNotify, formatNotifyLabel, resolveNotifyIds } from './helpers.js'

type ReplyOptions = MutationOptions & {
    notify?: string
    close?: boolean
    reopen?: boolean
    file?: string[]
}

export async function replyToThread(
    ref: string,
    content: string | undefined,
    options: ReplyOptions,
): Promise<void> {
    const threadId = resolveThreadId(ref)

    if (options.close && options.reopen) {
        throw new CliError('CONFLICTING_OPTIONS', 'Cannot use --close and --reopen together.')
    }

    const files = options.file ?? []
    const hasFiles = files.length > 0

    if (hasFiles && (options.close || options.reopen)) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot attach files with --close or --reopen. Post the attachment separately.',
        )
    }

    let replyContent = await readStdin()
    if (!replyContent && content) {
        replyContent = content
    }
    // A file-only reply is allowed: skip the editor prompt and the empty-content guard.
    if (!replyContent && !hasFiles) {
        replyContent = await openEditor()
    }
    if ((!replyContent || replyContent.trim() === '') && !hasFiles) {
        throw new CliError(
            'MISSING_CONTENT',
            'No content provided. Pass content as an argument, pipe via stdin, or attach a file.',
        )
    }
    const messageContent = replyContent ?? ''

    const notifyValue = options.notify ?? 'EVERYONE_IN_THREAD'
    const isSpecialRecipient = notifyValue === 'EVERYONE' || notifyValue === 'EVERYONE_IN_THREAD'

    const client = await getCommsClient()
    const thread = await client.threads.getThread(threadId)
    await assertChannelIsPublic(thread.channelId, thread.workspaceId)

    let recipients: string | number[] | undefined
    let resolved: ResolvedNotify | undefined
    if (isSpecialRecipient) {
        recipients = notifyValue
    } else {
        const allIds = parseNotifyIdRefs(notifyValue)
        resolved = await resolveNotifyIds(allIds, thread.workspaceId)
        recipients = resolved.recipients
    }

    const action = options.close ? 'close' : options.reopen ? 'reopen' : undefined
    const actionLabel = action === 'close' ? 'close' : action === 'reopen' ? 'reopen' : undefined

    if (options.dryRun) {
        // Validate attachment paths so the preview fails on a bad path exactly
        // as a real run would (no upload happens in dry-run).
        if (hasFiles) {
            await validateAttachmentFiles(files)
        }
        const actionSuffix = actionLabel ? ` and ${actionLabel} it` : ''
        const preview =
            messageContent.length > 200 ? `${messageContent.slice(0, 200)}...` : messageContent
        printDryRun(`post comment to thread${actionSuffix}`, {
            Thread: `${thread.title} (${threadId})`,
            Notify: isSpecialRecipient ? notifyValue : undefined,
            'Notify users':
                !isSpecialRecipient && resolved && resolved.notified.users.length > 0
                    ? formatNotifyLabel(resolved.notified.users)
                    : undefined,
            'Notify groups':
                !isSpecialRecipient && resolved && resolved.notified.groups.length > 0
                    ? formatNotifyLabel(resolved.notified.groups)
                    : undefined,
            Attach: hasFiles ? files.join(', ') : undefined,
            Content: preview || undefined,
        })
        return
    }

    const attachments = hasFiles ? await uploadAttachments(files) : undefined
    const groupsPayload = resolved?.groups ? { groups: resolved.groups } : {}

    // Type-checked against the SDK contract — notably `attachments`. Only `recipients`
    // needs the assertion below: it carries the EVERYONE / EVERYONE_IN_THREAD sentinels
    // the SDK type doesn't model.
    const createCommentArgs = {
        threadId,
        content: messageContent,
        ...groupsPayload,
        ...(attachments ? { attachments } : {}),
    } satisfies Parameters<typeof client.comments.createComment>[0]

    const comment =
        action === 'close'
            ? await client.threads.closeThread({
                  id: threadId,
                  content: messageContent,
                  recipients,
                  ...groupsPayload,
              } as Parameters<typeof client.threads.closeThread>[0])
            : action === 'reopen'
              ? await client.threads.reopenThread({
                    id: threadId,
                    content: messageContent,
                    recipients,
                    ...groupsPayload,
                } as Parameters<typeof client.threads.reopenThread>[0])
              : await client.comments.createComment({
                    ...createCommentArgs,
                    recipients,
                } as Parameters<typeof client.comments.createComment>[0])

    if (options.json) {
        const output = resolved ? { ...comment, notified: resolved.notified } : comment
        console.log(formatJson(output, 'comment', options.full))
        return
    }

    const suffix = actionLabel ? ` (thread ${actionLabel === 'close' ? 'closed' : 'reopened'})` : ''
    console.log(`Comment posted${suffix}: ${comment.url}`)
    if (attachments && attachments.length > 0) {
        const names = attachments.map((a) => a.fileName ?? 'file').join(', ')
        console.log(chalk.dim(`Attached: ${names}`))
    }
}

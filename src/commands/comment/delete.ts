import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { resolveCommentId } from '../../lib/refs.js'

type DeleteOptions = MutationOptions

export async function deleteComment(ref: string, options: DeleteOptions): Promise<void> {
    const commentId = resolveCommentId(ref)

    const client = await getCommsClient()
    const [comment, user] = await Promise.all([
        client.comments.getComment(commentId),
        client.users.getSessionUser(),
    ])

    await assertChannelIsPublic(comment.channelId, comment.workspaceId)

    if (comment.creator !== user.id) {
        throw new CliError('NOT_CREATOR', 'You can only delete comments that you created.')
    }

    if (options.dryRun) {
        const preview =
            comment.content.length > 200 ? `${comment.content.slice(0, 200)}...` : comment.content
        printDryRun('delete comment', {
            Comment: commentId,
            Thread: comment.threadId,
            Content: preview,
        })
        return
    }

    await client.comments.deleteComment(commentId)

    if (options.json) {
        console.log(formatJson({ id: commentId, deleted: true }))
        return
    }

    console.log(`Comment ${commentId} deleted.`)
}

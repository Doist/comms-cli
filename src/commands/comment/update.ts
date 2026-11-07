import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { openEditor, readContent } from '../../lib/input.js'
import type { MutationOptions, StdinOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { resolveCommentId } from '../../lib/refs.js'

type UpdateOptions = MutationOptions & StdinOptions

export async function updateComment(
    ref: string,
    content: string | undefined,
    options: UpdateOptions,
): Promise<void> {
    const commentId = resolveCommentId(ref)

    let newContent = await readContent(content, options)
    if (!newContent) {
        newContent = await openEditor()
    }
    if (!newContent || newContent.trim() === '') {
        throw new CliError(
            'MISSING_CONTENT',
            'No content provided. Pass content as an argument, or pipe it in with --stdin.',
        )
    }

    if (options.dryRun) {
        const preview = newContent.length > 200 ? `${newContent.slice(0, 200)}...` : newContent
        printDryRun('update comment', {
            Comment: String(commentId),
            Content: preview,
        })
        return
    }

    const client = await getCommsClient()
    const comment = await client.comments.updateComment({
        id: commentId,
        content: newContent,
    })

    if (options.json) {
        console.log(formatJson(comment, 'comment', options.full))
        return
    }

    console.log(`Comment updated: ${comment.url}`)
}

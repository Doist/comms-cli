import { Command } from 'commander'
import { deleteComment } from './delete.js'
import { updateComment } from './update.js'
import { viewComment } from './view.js'

export function registerCommentCommand(program: Command): void {
    const comment = program
        .command('comment')
        .description('Thread comment operations (view, update, delete)')

    comment
        .command('view [comment-ref]', { isDefault: true })
        .description('View a single thread comment')
        .option('--raw', 'Show raw markdown instead of rendered')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc comment 12345
  tdc comment view 12345 --json`,
        )
        .action((ref, options) => {
            if (!ref) {
                comment.help()
                return
            }
            return viewComment(ref, options)
        })

    comment
        .command('update <comment-ref> [content]')
        .description('Update a thread comment')
        .option('--dry-run', 'Show what would be updated without updating')
        .option('--json', 'Output updated comment as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc comment update 12345 "Updated text"
  echo "New content" | tdc comment update 12345
  tdc comment update 12345 "Fixed" --json`,
        )
        .action(updateComment)

    comment
        .command('delete <comment-ref>')
        .description('Delete a thread comment')
        .option('--yes', 'Confirm deletion')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .addHelpText(
            'after',
            `
Examples:
  tdc comment delete 12345 --yes
  tdc comment delete 12345 --dry-run`,
        )
        .action(deleteComment)
}

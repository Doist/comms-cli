import { Command } from 'commander'
import { deleteMessage } from './delete.js'
import { updateMessage } from './update.js'
import { viewMessage } from './view.js'

export function registerMsgCommand(program: Command): void {
    const msg = program
        .command('msg')
        .alias('message')
        .description('Conversation message operations (view, update, delete)')

    msg.command('view [message-ref]', { isDefault: true })
        .description('View a single conversation message')
        .option('--raw', 'Show raw markdown instead of rendered')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc msg id:CbS8n2Kp4Qx6Rz9Lm3Va
  tdc msg view id:CbS8n2Kp4Qx6Rz9Lm3Va --json`,
        )
        .action((ref, options) => {
            if (!ref) {
                msg.help()
                return
            }
            return viewMessage(ref, options)
        })

    msg.command('update <message-ref> [content]')
        .description('Edit a conversation message')
        .option('--dry-run', 'Show what would be updated without updating')
        .option('--json', 'Output updated message as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc msg update id:CbS8n2Kp4Qx6Rz9Lm3Va "Updated text"
  echo "New content" | tdc msg update id:CbS8n2Kp4Qx6Rz9Lm3Va
  tdc msg update id:CbS8n2Kp4Qx6Rz9Lm3Va "Fixed typo" --json`,
        )
        .action(updateMessage)

    msg.command('delete <message-ref>')
        .description('Delete a conversation message')
        .option('--yes', 'Confirm deletion')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .addHelpText(
            'after',
            `
Examples:
  tdc msg delete id:CbS8n2Kp4Qx6Rz9Lm3Va --yes
  tdc msg delete id:CbS8n2Kp4Qx6Rz9Lm3Va --dry-run`,
        )
        .action(deleteMessage)
}

import { Command } from 'commander'
import { createGroupCommand } from './create.js'
import { deleteGroupCommand } from './delete.js'
import { listGroups } from './list.js'
import { addUsersCommand, removeUsersCommand } from './members.js'
import { renameGroup } from './rename.js'
import { viewGroup } from './view.js'

export function registerGroupsCommand(program: Command): void {
    const groups = program.command('groups').description('Group operations')

    groups
        .command('list [workspace-ref]', { isDefault: true })
        .description('List groups in a workspace')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option('--search <text>', 'Filter by name')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--ids-only', 'Output only group IDs, one per line')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc groups
  tdc groups list --search front
  tdc groups --workspace 123 --json`,
        )
        .action(listGroups)

    groups
        .command('view <group-ref>')
        .description('Show a group with its members')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc groups view id:CbG8n2Kp4Qx6Rz9Lm3Va
  tdc groups view "Frontend"
  tdc groups view id:CbG8n2Kp4Qx6Rz9Lm3Va --json`,
        )
        .action(viewGroup)

    groups
        .command('create <name>')
        .description('Create a new group')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option('--users <refs>', 'Comma-separated user references to add (id:N, email, or name)')
        .option('--dry-run', 'Show what would be created without creating')
        .option('--json', 'Output created group as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc groups create "Frontend"
  tdc groups create "Backend" --users alice@doist.com,bob@doist.com
  tdc groups create "Design" --users id:123,id:456 --json`,
        )
        .action(createGroupCommand)

    groups
        .command('rename <group-ref> <new-name>')
        .description('Rename a group')
        .option('--dry-run', 'Show what would be renamed without renaming')
        .option('--json', 'Output updated group as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc groups rename id:CbG8n2Kp4Qx6Rz9Lm3Va "Frontend Team"
  tdc groups rename "Frontend" "Frontend Team" --json`,
        )
        .action(renameGroup)

    groups
        .command('delete <group-ref>')
        .description('Permanently delete a group')
        .option('--yes', 'Confirm deletion')
        .option('--dry-run', 'Show what would happen without executing')
        .option('--json', 'Output result as JSON')
        .addHelpText(
            'after',
            `
Examples:
  tdc groups delete id:CbG8n2Kp4Qx6Rz9Lm3Va --yes
  tdc groups delete "Frontend" --dry-run`,
        )
        .action(deleteGroupCommand)

    groups
        .command('add-user <group-ref> [user-refs...]')
        .description('Add one or more users to a group')
        .option('--dry-run', 'Show what would change without changing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include the full updated group in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc groups add-user id:CbG8n2Kp4Qx6Rz9Lm3Va alice@doist.com bob@doist.com
  tdc groups add-user "Frontend" id:123,id:456
  tdc groups add-user id:CbG8n2Kp4Qx6Rz9Lm3Va alice bob carol --json

User references can be passed as space-separated args, comma-separated within a
single arg, or any mix of the two.`,
        )
        .action(addUsersCommand)

    groups
        .command('remove-user <group-ref> [user-refs...]')
        .description('Remove one or more users from a group')
        .option('--dry-run', 'Show what would change without changing')
        .option('--json', 'Output result as JSON')
        .option('--full', 'Include the full updated group in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc groups remove-user id:CbG8n2Kp4Qx6Rz9Lm3Va alice@doist.com
  tdc groups remove-user "Frontend" id:123,id:456`,
        )
        .action(removeUsersCommand)
}

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
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  cm groups
  cm groups list --search front
  cm groups --workspace 123 --json`,
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
  cm groups view 12345
  cm groups view "Frontend"
  cm groups view id:12345 --json`,
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
  cm groups create "Frontend"
  cm groups create "Backend" --users alice@doist.com,bob@doist.com
  cm groups create "Design" --users id:123,id:456 --json`,
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
  cm groups rename 12345 "Frontend Team"
  cm groups rename "Frontend" "Frontend Team" --json`,
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
  cm groups delete 12345 --yes
  cm groups delete "Frontend" --dry-run`,
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
  cm groups add-user 12345 alice@doist.com bob@doist.com
  cm groups add-user "Frontend" id:123,id:456
  cm groups add-user 12345 alice bob carol --json

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
  cm groups remove-user 12345 alice@doist.com
  cm groups remove-user "Frontend" id:123,id:456`,
        )
        .action(removeUsersCommand)
}

import { outputIds, resolveOutputMode } from '@doist/cli-core'
import chalk from 'chalk'
import { Command } from 'commander'
import {
    getCommsClient,
    getCurrentWorkspaceId,
    getSessionUser,
    getWorkspaceUsers,
} from '../lib/api.js'
import { CliError } from '../lib/errors.js'
import type { ViewOptions } from '../lib/options.js'
import { colors, formatJson, formatNdjson, printEmpty } from '../lib/output.js'
import { resolveWorkspaceRef } from '../lib/refs.js'

type UsersOptions = ViewOptions & {
    workspace?: string
    search?: string
    includeRemoved?: boolean
}

async function showCurrentUser(options: ViewOptions): Promise<void> {
    const user = await getSessionUser()
    const client = await getCommsClient()
    const defaultWorkspace = await client.workspaces.getDefaultWorkspace().catch(() => null)

    if (options.json) {
        const payload = defaultWorkspace
            ? { ...user, defaultWorkspaceId: defaultWorkspace.id }
            : user
        console.log(formatJson(payload, 'user', options.full))
        return
    }

    console.log(chalk.bold(user.fullName))
    console.log('')
    console.log(`ID:        ${user.id}`)
    console.log(`Email:     ${user.email}`)
    console.log(`Timezone:  ${user.timezone}`)
    if (defaultWorkspace) {
        console.log(`Default:   ${defaultWorkspace.name} (id:${defaultWorkspace.id})`)
    }
}

async function listUsers(workspaceRef: string | undefined, options: UsersOptions): Promise<void> {
    const outputMode = resolveOutputMode(options)
    if (workspaceRef && options.workspace) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot specify workspace both as argument and --workspace flag',
        )
    }

    let workspaceId: number
    const ref = workspaceRef || options.workspace

    if (ref) {
        const workspace = await resolveWorkspaceRef(ref)
        workspaceId = workspace.id
    } else {
        workspaceId = await getCurrentWorkspaceId()
    }

    let users = await getWorkspaceUsers(workspaceId, { includeRemoved: options.includeRemoved })

    if (options.search) {
        const search = options.search.toLowerCase()
        users = users.filter(
            (u) =>
                u.fullName.toLowerCase().includes(search) ||
                u.email?.toLowerCase().includes(search),
        )
    }

    if (users.length === 0) {
        printEmpty({ options, type: 'user', message: 'No users found.' })
        return
    }

    if (outputMode === 'ids-only') {
        await outputIds(users, (user) => user.id)
        return
    }

    if (outputMode === 'json') {
        console.log(formatJson(users, 'user', options.full))
        return
    }

    if (outputMode === 'ndjson') {
        console.log(formatNdjson(users, 'user', options.full))
        return
    }

    for (const u of users) {
        const id = colors.timestamp(`id:${u.id}`)
        const name = u.fullName
        const email = u.email ? colors.timestamp(`<${u.email}>`) : ''
        const type = colors.channel(`[${u.userType}]`)
        const removed = u.removed ? chalk.red(' [removed]') : ''
        console.log(`${id}  ${name} ${email} ${type}${removed}`)
    }
}

export function registerUserCommand(program: Command): void {
    program
        .command('user')
        .description('Show current user info')
        .option('--json', 'Output as JSON')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc user
  tdc user --json`,
        )
        .action(showCurrentUser)

    program
        .command('users [workspace-ref]')
        .description('List users in a workspace')
        .option('--workspace <ref>', 'Workspace ID or name')
        .option('--search <text>', 'Filter by name/email')
        .option('--include-removed', 'Include users who have been removed from the workspace')
        .option('--json', 'Output as JSON')
        .option('--ndjson', 'Output as newline-delimited JSON')
        .option('--ids-only', 'Output only user IDs, one per line')
        .option('--full', 'Include all fields in JSON output')
        .addHelpText(
            'after',
            `
Examples:
  tdc users
  tdc users --search "Jane" --json
  tdc users --include-removed`,
        )
        .action(listUsers)
}

import { outputIds, printEmpty, resolveOutputMode } from '@doist/cli-core'
import { getCurrentWorkspaceId, getWorkspaceGroups } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import type { ViewOptions } from '../../lib/options.js'
import { colors, formatJson, formatNdjson, pluralize } from '../../lib/output.js'
import { resolveWorkspaceRef } from '../../lib/refs.js'

export type ListGroupsOptions = ViewOptions & { workspace?: string; search?: string }

export async function listGroups(
    workspaceRef: string | undefined,
    options: ListGroupsOptions,
): Promise<void> {
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

    let groups = await getWorkspaceGroups(workspaceId)

    if (options.search) {
        const query = options.search.toLowerCase()
        groups = groups.filter((g) => g.name.toLowerCase().includes(query))
    }

    if (groups.length === 0) {
        printEmpty({ options, message: 'No groups found.' })
        return
    }

    if (outputMode === 'ids-only') {
        await outputIds(groups, (group) => group.id)
        return
    }

    if (outputMode === 'json') {
        console.log(formatJson(groups, 'group', options.full))
        return
    }

    if (outputMode === 'ndjson') {
        console.log(formatNdjson(groups, 'group', options.full))
        return
    }

    for (const g of groups) {
        const id = colors.timestamp(`id:${g.id}`)
        const name = colors.channel(g.name)
        const members = colors.timestamp(
            `(${g.userIds.length} ${pluralize(g.userIds.length, 'member')})`,
        )
        console.log(`${id}  ${name}  ${members}`)
    }
}

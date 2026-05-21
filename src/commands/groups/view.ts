import { getCurrentWorkspaceId, getWorkspaceUsers } from '../../lib/api.js'
import type { ViewOptions } from '../../lib/options.js'
import { colors, formatJson, formatNdjson, pluralize } from '../../lib/output.js'
import { resolveGroupRef } from '../../lib/refs.js'

type GroupViewOptions = ViewOptions & { full?: boolean }

export async function viewGroup(ref: string, options: GroupViewOptions): Promise<void> {
    const workspaceId = await getCurrentWorkspaceId()
    const group = await resolveGroupRef(ref, workspaceId)

    const workspaceUsers = await getWorkspaceUsers(workspaceId)
    const userMap = new Map(workspaceUsers.map((u) => [u.id, u]))

    const members = group.userIds.map((id) => {
        const user = userMap.get(id)
        return {
            id,
            name: user?.fullName ?? null,
            email: user?.email ?? null,
        }
    })

    if (options.json) {
        if (options.full) {
            console.log(formatJson({ ...group, members }))
        } else {
            console.log(
                formatJson({
                    id: group.id,
                    name: group.name,
                    workspaceId: group.workspaceId,
                    members,
                }),
            )
        }
        return
    }

    if (options.ndjson) {
        console.log(formatNdjson([{ ...group, members }]))
        return
    }

    console.log(colors.channel(group.name))
    console.log(colors.timestamp(`id:${group.id}`))
    console.log('')
    console.log(`${members.length} ${pluralize(members.length, 'member')}`)
    if (members.length === 0) return

    for (const m of members) {
        const name = m.name ?? `user:${m.id}`
        const email = m.email ? colors.timestamp(`<${m.email}>`) : ''
        const id = colors.timestamp(`id:${m.id}`)
        console.log(`  ${id}  ${colors.author(name)} ${email}`.trimEnd())
    }
}

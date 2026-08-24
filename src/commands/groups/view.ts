import { isRestrictedWorkspaceUser } from '@doist/comms-sdk'
import { getCommsClient, getCurrentWorkspaceId } from '../../lib/api.js'
import type { ViewOptions } from '../../lib/options.js'
import { colors, formatJson, formatNdjson, pluralize } from '../../lib/output.js'
import { resolveGroupRef } from '../../lib/refs.js'

type GroupViewOptions = ViewOptions & { full?: boolean }

export async function viewGroup(ref: string, options: GroupViewOptions): Promise<void> {
    const workspaceId = await getCurrentWorkspaceId()
    const group = await resolveGroupRef(ref, workspaceId)

    const client = await getCommsClient()
    // Per-member fetch avoids loading the whole workspace directory for a small group.
    const members = await Promise.all(
        group.userIds.map(async (id) => {
            try {
                const user = await client.workspaceUsers.getUserById({
                    workspaceId,
                    userId: id,
                })
                const email = isRestrictedWorkspaceUser(user) ? null : (user.email ?? null)
                return { id, name: user.fullName, email }
            } catch {
                return { id, name: null as string | null, email: null as string | null }
            }
        }),
    )

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

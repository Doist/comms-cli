import { resolveOutputMode } from '@doist/cli-core'
import { getCurrentWorkspaceId, getSessionUser, getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { resolveUserRefs, resolveWorkspaceRef } from '../../lib/refs.js'
import {
    type ConversationWithOptions,
    findDirectConversation,
    getConversationsByState,
    renderConversationList,
} from './helpers.js'

export async function findConversationWithUser(
    userRef: string,
    workspaceRef: string | undefined,
    options: ConversationWithOptions,
): Promise<void> {
    resolveOutputMode(options)
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

    const userIds = await resolveUserRefs(userRef, workspaceId)
    if (userIds.length !== 1) {
        throw new CliError('INVALID_REF', 'Expected a single user reference')
    }

    const targetUserId = userIds[0]
    const client = await getCommsClient()
    const [sessionUser, targetUser] = await Promise.all([
        getSessionUser(),
        client.workspaceUsers.getUserById({ workspaceId, userId: targetUserId }),
    ])

    if (options.includeGroups) {
        const conversations = await getConversationsByState(workspaceId)
        const matchingConversations = conversations.filter((conversation) =>
            conversation.userIds.includes(targetUser.id),
        )

        await renderConversationList(matchingConversations, workspaceId, options)
        return
    }

    const { directConversation, groupConversationCount } = await findDirectConversation(
        workspaceId,
        sessionUser.id,
        targetUser.id,
    )

    if (!directConversation) {
        if (options.json || options.ndjson) {
            await renderConversationList([], workspaceId, options)
            return
        }

        const suggestion =
            groupConversationCount > 0
                ? ` Found ${groupConversationCount} group conversation${groupConversationCount === 1 ? '' : 's'} with ${targetUser.fullName}. Use --include-groups to list them.`
                : ''

        console.log(`No 1:1 conversation found with ${targetUser.fullName}.${suggestion}`)
        return
    }

    await renderConversationList([directConversation], workspaceId, options)
}

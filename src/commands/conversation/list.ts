import { getCurrentWorkspaceId } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { resolveUserRefs, resolveWorkspaceRef } from '../../lib/refs.js'
import {
    type ConversationListOptions,
    type ConversationState,
    getConversationsByState,
    renderConversationList,
} from './helpers.js'

type ConversationKind = 'group' | 'direct'

// `--kind` and `--state` are validated by Commander (withCaseInsensitiveChoices),
// so these only narrow the already-restricted string to its union type and apply
// the `active` default.
function resolveState(state: string | undefined): ConversationState {
    return state === 'all' || state === 'archived' ? state : 'active'
}

function resolveKind(kind: string | undefined): ConversationKind | undefined {
    return kind === 'group' || kind === 'direct' ? kind : undefined
}

function parseLimit(value: string | undefined): number | undefined {
    if (value === undefined) return undefined
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new CliError(
            'INVALID_LIMIT',
            `Invalid --limit value: ${value} (must be a positive integer)`,
        )
    }
    return parsed
}

export async function listConversations(
    workspaceRef: string | undefined,
    options: ConversationListOptions,
): Promise<void> {
    if (workspaceRef && options.workspace) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot specify workspace both as argument and --workspace flag',
        )
    }

    const state = resolveState(options.state)
    const kind = resolveKind(options.kind)
    const limit = parseLimit(options.limit)

    let workspaceId: number
    const ref = workspaceRef || options.workspace
    if (ref) {
        const workspace = await resolveWorkspaceRef(ref)
        workspaceId = workspace.id
    } else {
        workspaceId = await getCurrentWorkspaceId()
    }

    // Resolve participants and fetch conversations concurrently — they're
    // independent once the workspace is known. `includeRemoved` so a participant
    // who has since left the workspace still resolves (the renderer already
    // shows removed participants, and archived DMs often include them).
    const [participantIds, fetched] = await Promise.all([
        options.participant
            ? resolveUserRefs(options.participant, workspaceId, { includeRemoved: true })
            : Promise.resolve(null),
        getConversationsByState(workspaceId, state),
    ])

    let conversations = fetched

    if (participantIds) {
        // Keep conversations that include every requested participant.
        conversations = conversations.filter((conversation) =>
            participantIds.every((id) => conversation.userIds.includes(id)),
        )
    }

    if (options.name) {
        const needle = options.name.toLowerCase()
        conversations = conversations.filter((conversation) =>
            (conversation.title ?? '').toLowerCase().includes(needle),
        )
    }

    if (kind) {
        // Direct = 1:1 (userIds: you + them === 2) or your self-conversation (=== 1).
        // Group = 3+ participants.
        conversations = conversations.filter((conversation) =>
            kind === 'group' ? conversation.userIds.length > 2 : conversation.userIds.length <= 2,
        )
    }

    if (limit !== undefined) {
        conversations = conversations.slice(0, limit)
    }

    await renderConversationList(conversations, workspaceId, options)
}

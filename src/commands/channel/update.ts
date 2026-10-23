import type { UpdateChannelArgs } from '@doist/comms-sdk'
import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { getDirectChannelId, resolveChannelRef } from '../../lib/refs.js'
import {
    type DefaultAudienceOptions,
    type DefaultAudienceArgs,
    buildDefaultAudienceArgs,
    clearDefaultAudienceArgs,
    defaultAudienceDryRun,
    validateDefaultAudienceOptions,
} from './default-audience.js'
import {
    resolveChannelWorkspaceId,
    resolveVisibilityOption,
    validateChannelName,
} from './helpers.js'

type UpdateChannelOptions = MutationOptions &
    DefaultAudienceOptions & {
        workspace?: string
        name?: string
        description?: string
        clearDescription?: boolean
        public?: boolean
        private?: boolean
    }

function buildDescriptionUpdate(options: UpdateChannelOptions): string | null | undefined {
    if (options.description !== undefined && options.clearDescription) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Use either --description or --clear-description, not both.',
        )
    }

    if (options.clearDescription) return null
    return options.description
}

function printUpdateDryRun(
    targetLabel: string,
    newName: string | undefined,
    description: string | null | undefined,
    visibility: boolean | undefined,
    defaultAudience: DefaultAudienceArgs,
): void {
    printDryRun('update channel', {
        Channel: targetLabel,
        ...defaultAudienceDryRun(defaultAudience),
        'New name': newName,
        Description:
            description === null ? '(clear)' : description !== undefined ? description : undefined,
        Visibility: visibility === undefined ? undefined : visibility ? 'public' : 'private',
    })
}

export async function updateChannel(
    channelRef: string,
    positionalName: string | undefined,
    options: UpdateChannelOptions,
): Promise<void> {
    validateDefaultAudienceOptions(options)
    const hasAudienceRefs =
        options.defaultGroups !== undefined || options.defaultUsers !== undefined
    let defaultAudience = clearDefaultAudienceArgs(options)

    if (positionalName && options.name) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot specify channel name both as an argument and --name.',
        )
    }

    const newName = positionalName ?? options.name
    if (newName !== undefined) {
        validateChannelName(newName)
    }

    const description = buildDescriptionUpdate(options)
    const visibility = resolveVisibilityOption(options)

    if (
        newName === undefined &&
        description === undefined &&
        visibility === undefined &&
        !hasAudienceRefs &&
        !options.clearDefaultAudience
    ) {
        throw new CliError('INVALID_VALUE', 'Provide at least one channel field to update.', [
            'Use a new name, --name, --description, --clear-description, --public, --private, --default-groups, --default-users, or --clear-default-audience.',
        ])
    }

    let targetLabel: string
    let channelId: string
    let updateName: string
    let client: Awaited<ReturnType<typeof getCommsClient>> | undefined

    const directChannelId = options.workspace ? null : getDirectChannelId(channelRef)
    if (directChannelId) {
        channelId = directChannelId
        if (newName === undefined && options.dryRun && !hasAudienceRefs) {
            printUpdateDryRun(
                `id:${directChannelId}`,
                newName,
                description,
                visibility,
                defaultAudience,
            )
            return
        }

        if (newName === undefined || hasAudienceRefs) {
            client = await getCommsClient()
            const channel = await client.channels.getChannel(directChannelId)
            updateName = newName ?? channel.name
            if (hasAudienceRefs) {
                defaultAudience = await buildDefaultAudienceArgs(options, channel.workspaceId)
            }
            targetLabel = `${channel.name} (id:${channel.id})`
        } else {
            updateName = newName
            targetLabel = `id:${directChannelId}`
        }
    } else {
        const workspaceId = await resolveChannelWorkspaceId(options.workspace)
        const channel = await resolveChannelRef(channelRef, workspaceId)
        if (hasAudienceRefs) {
            defaultAudience = await buildDefaultAudienceArgs(options, channel.workspaceId)
        }
        channelId = channel.id
        updateName = newName ?? channel.name
        targetLabel = `${channel.name} (id:${channel.id})`
    }

    if (options.dryRun) {
        printUpdateDryRun(targetLabel, newName, description, visibility, defaultAudience)
        return
    }

    const args: UpdateChannelArgs = {
        ...defaultAudience,
        id: channelId,
        name: updateName,
        ...(description !== undefined ? { description } : {}),
        ...(visibility !== undefined ? { public: visibility } : {}),
    }

    client ??= await getCommsClient()
    const updated = await client.channels.updateChannel(args)

    if (options.json) {
        console.log(formatJson(updated, 'channel', options.full))
        return
    }

    console.log(`Channel "${updated.name}" (id:${updated.id}) updated.`)
}

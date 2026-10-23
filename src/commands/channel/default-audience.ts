import type { Group, UpdateChannelArgs } from '@doist/comms-sdk'
import { getWorkspaceGroups } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { parseRef, resolveGroupRef, resolveUserRefs } from '../../lib/refs.js'

export type DefaultAudienceOptions = {
    defaultGroups?: string
    defaultUsers?: string
    clearDefaultAudience?: boolean
}

export type DefaultAudienceArgs = Pick<
    UpdateChannelArgs,
    'useDefaultRecipients' | 'defaultGroups' | 'defaultRecipients'
>

export function validateDefaultAudienceOptions(options: DefaultAudienceOptions): void {
    if (
        options.clearDefaultAudience &&
        (options.defaultGroups !== undefined || options.defaultUsers !== undefined)
    ) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot combine --clear-default-audience with --default-groups or --default-users.',
        )
    }

    for (const [flag, refs] of [
        ['--default-groups', options.defaultGroups],
        ['--default-users', options.defaultUsers],
    ]) {
        if (refs !== undefined && refs.split(',').some((ref) => !ref.trim())) {
            throw new CliError('INVALID_VALUE', `${flag} requires non-empty references.`, [
                'Use --clear-default-audience to clear the default audience.',
            ])
        }
    }
}

export async function buildDefaultAudienceArgs(
    options: DefaultAudienceOptions,
    workspaceId: number,
): Promise<DefaultAudienceArgs> {
    let groupsPromise: Promise<Group[]> | undefined
    if (options.defaultGroups !== undefined) {
        const refs = options.defaultGroups.split(',').map((ref) => ref.trim())
        const workspaceGroups = refs.some((ref) => parseRef(ref).type === 'name')
            ? getWorkspaceGroups(workspaceId)
            : undefined
        groupsPromise = Promise.all(
            refs.map((ref) => resolveGroupRef(ref, workspaceId, workspaceGroups)),
        )
    }
    const usersPromise =
        options.defaultUsers !== undefined
            ? resolveUserRefs(options.defaultUsers, workspaceId)
            : undefined
    const [groups, userIds] = await Promise.all([groupsPromise, usersPromise])

    const args: DefaultAudienceArgs = {}
    if (groups !== undefined) {
        args.defaultGroups = groups.map((group) => group.id)
        args.useDefaultRecipients = true
    }
    if (userIds !== undefined) {
        args.defaultRecipients = userIds
        args.useDefaultRecipients = true
    }
    return args
}

export function clearDefaultAudienceArgs(options: DefaultAudienceOptions): DefaultAudienceArgs {
    return options.clearDefaultAudience
        ? { useDefaultRecipients: false, defaultGroups: [], defaultRecipients: [] }
        : {}
}

export function defaultAudienceDryRun(
    args: DefaultAudienceArgs,
): Record<string, string | undefined> {
    return {
        useDefaultRecipients: args.useDefaultRecipients?.toString(),
        defaultGroups: args.defaultGroups ? JSON.stringify(args.defaultGroups) : undefined,
        defaultRecipients: args.defaultRecipients
            ? JSON.stringify(args.defaultRecipients)
            : undefined,
    }
}

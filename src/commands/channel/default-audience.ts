import type { UpdateChannelArgs } from '@doist/comms-sdk'
import { CliError } from '../../lib/errors.js'
import { resolveGroupRef, resolveUserRefs } from '../../lib/refs.js'

export type DefaultAudienceOptions = {
    defaultGroups?: string
    defaultUsers?: string
    clearDefaultAudience?: boolean
}

// SDK 3.3 forwards this boolean but omits it from its channel request types.
export type DefaultAudienceArgs = Pick<UpdateChannelArgs, 'defaultGroups' | 'defaultRecipients'> & {
    useDefaultRecipients?: boolean
}

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
    const args: DefaultAudienceArgs = {}
    if (options.defaultGroups !== undefined) {
        const groups = await Promise.all(
            options.defaultGroups.split(',').map((ref) => resolveGroupRef(ref.trim(), workspaceId)),
        )
        args.defaultGroups = groups.map((group) => group.id)
        args.useDefaultRecipients = true
    }
    if (options.defaultUsers !== undefined) {
        args.defaultRecipients = await resolveUserRefs(options.defaultUsers, workspaceId)
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

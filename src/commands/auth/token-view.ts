import type { Command } from 'commander'
import { getApiTokenSnapshot, NoTokenError, TOKEN_ENV_VAR } from '../../lib/auth.js'
import { CliError } from '../../lib/errors.js'

type TokenViewOptions = {
    user?: string
}

const USER_FLAG_DESCRIPTION = 'Target a specific stored account'

export function attachCommsTokenViewCommand(
    parent: Command,
    requestedRef: string | undefined,
): Command {
    return parent
        .command('view')
        .description(
            'Print the stored API token for the active user (or --user <ref>) to stdout for use in scripts',
        )
        .option('--user <ref>', USER_FLAG_DESCRIPTION)
        .action((options: TokenViewOptions) => viewToken(options.user ?? requestedRef))
}

async function viewToken(ref: string | undefined): Promise<void> {
    if (process.env[TOKEN_ENV_VAR]) {
        throw new CliError(
            'TOKEN_FROM_ENV',
            `Refusing to print: token is being read from $${TOKEN_ENV_VAR}, not the saved store.`,
            [
                `Unset ${TOKEN_ENV_VAR} to view the stored token.`,
                'The env var takes precedence over saved tokens; printing it would disclose a secret the CLI did not manage.',
            ],
        )
    }

    try {
        const snapshot = await getApiTokenSnapshot(ref)
        process.stdout.write(snapshot.token)
        if (process.stdout.isTTY) process.stdout.write('\n')
    } catch (error) {
        if (error instanceof NoTokenError) {
            if (ref !== undefined) {
                throw new CliError('ACCOUNT_NOT_FOUND', `No stored account matches "${ref}".`)
            }
            throw new CliError('NOT_AUTHENTICATED', 'Not signed in.')
        }
        throw error
    }
}

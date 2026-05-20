import { attachTokenViewCommand } from '@doist/cli-core/auth'
import { Command } from 'commander'
import { createCommsTokenStore } from '../../lib/auth-provider.js'
import { TOKEN_ENV_VAR } from '../../lib/auth.js'
import { getRequestedUserRef } from '../../lib/global-args.js'
import { attachCommsLoginCommand } from './login.js'
import { attachCommsLogoutCommand } from './logout.js'
import { attachCommsStatusCommand } from './status.js'
import { withUserRefAware } from './store-wrap.js'
import { loginWithToken } from './token.js'

export function registerAuthCommand(program: Command): void {
    const auth = program.command('auth').description('Manage authentication')

    const store = createCommsTokenStore()
    const refAware = withUserRefAware(store, getRequestedUserRef())

    attachCommsLoginCommand(auth, store)
    attachCommsLogoutCommand(auth, refAware)
    attachCommsStatusCommand(auth, refAware)

    // `token` is a hybrid: the positional `[token]` saves, and the `view`
    // subcommand prints. Commander matches subcommand names before the parent
    // action, so `cm auth token view` always dispatches to the view path —
    // Comms OAuth tokens are opaque random strings so the literal "view" can
    // never collide with a real token value.
    const tokenCmd = auth
        .command('token [token]')
        .description('Save API token for CLI authentication (or use a subcommand: `view`)')
        .action(loginWithToken)

    attachTokenViewCommand(tokenCmd, {
        name: 'view',
        store: refAware,
        envVarName: TOKEN_ENV_VAR,
        description:
            'Print the stored API token for the active user (or --user <ref>) to stdout for use in scripts',
    })
}

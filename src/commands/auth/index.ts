import { Command } from 'commander'
import { createCommsTokenStore } from '../../lib/auth-provider.js'
import { getRequestedUserRef } from '../../lib/global-args.js'
import { attachCommsLoginCommand } from './login.js'
import { attachCommsLogoutCommand } from './logout.js'
import { attachCommsStatusCommand } from './status.js'
import { withUserRefAware } from './store-wrap.js'
import { attachCommsTokenViewCommand } from './token-view.js'
import { loginWithToken } from './token.js'

export function registerAuthCommand(program: Command): void {
    const auth = program.command('auth').description('Manage authentication')

    const store = createCommsTokenStore()
    const requestedRef = getRequestedUserRef()
    const refAware = withUserRefAware(store, requestedRef)

    attachCommsLoginCommand(auth, store)
    attachCommsLogoutCommand(auth, refAware)
    attachCommsStatusCommand(auth, refAware)

    // `token` is a hybrid: bare `tdc auth token` prompts interactively to save
    // a token, and the `view` subcommand prints it. Tokens are never accepted
    // as positional/CLI arguments — that would leak them via process lists
    // and shell history (Doist Secrets Management Standard).
    const tokenCmd = auth
        .command('token')
        .description('Save API token for CLI authentication (or use a subcommand: `view`)')
        .action(() => loginWithToken())

    attachCommsTokenViewCommand(tokenCmd, requestedRef)
}

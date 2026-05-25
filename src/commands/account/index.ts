import { emitView } from '@doist/cli-core'
import {
    attachAccountCurrentCommand,
    attachAccountListCommand,
    attachAccountRemoveCommand,
    attachAccountUseCommand,
} from '@doist/cli-core/auth'
import chalk from 'chalk'
import { Command } from 'commander'
import {
    type CommsTokenStore,
    createCommsTokenStore,
    isManualTokenAccount,
} from '../../lib/auth-provider.js'
import { TOKEN_ENV_VAR } from '../../lib/auth.js'
import { CliError } from '../../lib/errors.js'
import { logStoredTokenRemoval } from '../auth/helpers.js'

/**
 * Hide identity-less manual-token snapshots (from `tdc auth token`) from `list`:
 * they can't be the target of `use` / `remove` and would render as blank
 * id/label rows. `account current` surfaces the active manual-token state
 * separately via its renderers. cli-core's list attacher reads the roster
 * through the store, so the filter lives in a store wrapper.
 */
function hideManualTokens(store: CommsTokenStore): CommsTokenStore {
    return Object.assign(Object.create(store) as CommsTokenStore, {
        async list() {
            const records = await store.list()
            return records.filter(({ account }) => !isManualTokenAccount(account))
        },
    })
}

export function registerAccountCommand(program: Command): void {
    const account = program.command('account').description('Manage stored CLI accounts')
    const store = createCommsTokenStore()

    attachAccountListCommand(account, {
        store: hideManualTokens(store),
        description: 'List stored CLI accounts',
        renderText: (ctx) => {
            if (ctx.accounts.length === 0) {
                return 'No stored accounts. Run `tdc auth login` to add one.'
            }
            const lines = [`Stored accounts (${ctx.accounts.length}):`]
            for (const { account: acc, isDefault } of ctx.accounts) {
                const marker = isDefault ? chalk.green('*') : ' '
                lines.push(`  ${marker} ${chalk.dim(`id:${acc.id}`)}  ${acc.label}`)
            }
            const def = ctx.accounts.find((entry) => entry.isDefault)
            if (def) {
                lines.push(`Default: ${chalk.dim(`id:${def.account.id}`)}  ${def.account.label}`)
            }
            return lines
        },
    })

    attachAccountUseCommand(account, {
        store,
        description: 'Set the default stored account (id, id:<n>, or display name)',
    })

    attachAccountRemoveCommand(account, {
        store,
        description: 'Remove a stored account (clears keyring + config entry)',
        onRemoved: (ctx) => logStoredTokenRemoval(store, ctx.view),
    })

    // env-token sessions resolve as `null` from `store.activeAccount()` (see
    // auth-provider.ts), so the env notice lives in `onNotAuthenticated` — the
    // one async hook. A manual-token snapshot stays a resolved account and is
    // special-cased in the renderers; a real account renders as `config`.
    attachAccountCurrentCommand(account, {
        store,
        description: 'Show the currently active account (honours COMMS_API_TOKEN)',
        renderText: ({ account: acc }) => {
            if (isManualTokenAccount(acc)) {
                return [
                    'Active token saved via `tdc auth token` (no associated identity).',
                    chalk.dim('Run `tdc auth login` to attach an account to the token.'),
                ]
            }
            const lines = [
                `Active account: ${chalk.dim(`id:${acc.id}`)}  ${acc.label}`,
                `  Mode:  ${acc.authMode}`,
            ]
            if (acc.authScope) lines.push(`  Scope: ${acc.authScope}`)
            return lines
        },
        renderJson: ({ account: acc }) =>
            isManualTokenAccount(acc)
                ? { source: 'token-only' }
                : {
                      id: acc.id,
                      label: acc.label,
                      authMode: acc.authMode,
                      authScope: acc.authScope || undefined,
                      source: 'config',
                  },
        async onNotAuthenticated({ view }) {
            if (process.env[TOKEN_ENV_VAR]) {
                emitView(view, { source: 'env' }, () => [
                    `Active token sourced from environment variable ${TOKEN_ENV_VAR} (no stored account).`,
                ])
                return
            }
            throw new CliError('NO_TOKEN', 'No stored account is currently active.', [
                'Run: tdc auth login',
            ])
        },
    })

    // The list attacher adds `list` without commander's `isDefault`, so wire the
    // parent default explicitly to keep `tdc account` (no subcommand) listing.
    ;(account as unknown as { _defaultCommandName: string })._defaultCommandName = 'list'

    account.addHelpText(
        'after',
        `
Examples:
  tdc account                       # list stored accounts (default subcommand)
  tdc account use "Alan Grant"      # pin Alan as the default account (id, id:N, or name)
  tdc account remove id:42          # forget id:42 (clears keyring + config entry)`,
    )
}

import { emitView } from '@doist/cli-core'
import chalk from 'chalk'
import type { CommsTokenStore } from '../../lib/auth-provider.js'
import { TOKEN_ENV_VAR } from '../../lib/auth.js'
import { CliError } from '../../lib/errors.js'
import type { ViewOptions } from '../../lib/options.js'

export async function currentAccount(options: ViewOptions, store: CommsTokenStore): Promise<void> {
    if (process.env[TOKEN_ENV_VAR]) {
        emitView(options, { source: 'env' }, () => [
            `Active token sourced from environment variable ${TOKEN_ENV_VAR} (no stored account).`,
        ])
        return
    }

    const snapshot = await store.active()
    if (!snapshot) {
        throw new CliError('NO_TOKEN', 'No stored account is currently active.', [
            'Run: cm auth login',
        ])
    }
    const { account } = snapshot

    // `cm auth token` persists `{ id: '', label: '' }` because manual token
    // entry has no identity. Render that case explicitly rather than printing
    // blank fields.
    if (!account.id || !account.label) {
        emitView(options, { source: 'token-only' }, () => [
            'Active token saved via `cm auth token` (no associated identity).',
            chalk.dim('Run `cm auth login` to attach an account to the token.'),
        ])
        return
    }

    emitView(
        options,
        {
            id: account.id,
            label: account.label,
            authMode: account.authMode,
            authScope: account.authScope || undefined,
            source: 'config',
        },
        () => {
            const lines = [
                `Active account: ${chalk.dim(`id:${account.id}`)}  ${account.label}`,
                `  Mode:  ${account.authMode}`,
            ]
            if (account.authScope) lines.push(`  Scope: ${account.authScope}`)
            return lines
        },
    )
}

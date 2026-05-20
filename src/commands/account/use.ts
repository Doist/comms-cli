import { emitView } from '@doist/cli-core'
import chalk from 'chalk'
import { findAccountInStore, type CommsTokenStore } from '../../lib/auth-provider.js'
import type { ViewOptions } from '../../lib/options.js'

export async function useAccount(
    ref: string,
    options: ViewOptions,
    store: CommsTokenStore,
): Promise<void> {
    const account = await findAccountInStore(store, ref)
    await store.setDefault(account.id)

    emitView(options, { id: account.id, label: account.label, isDefault: true }, () => [
        `✓ Default account set to ${chalk.dim(`id:${account.id}`)}  ${account.label}`,
    ])
}

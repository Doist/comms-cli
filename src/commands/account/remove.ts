import { emitView } from '@doist/cli-core'
import chalk from 'chalk'
import { findAccountInStore, type CommsTokenStore } from '../../lib/auth-provider.js'
import type { ViewOptions } from '../../lib/options.js'
import { logTokenStorageResult } from '../auth/helpers.js'

export async function removeAccount(
    ref: string,
    options: ViewOptions,
    store: CommsTokenStore,
): Promise<void> {
    const account = await findAccountInStore(store, ref)
    await store.clear(account.id)

    emitView(options, { id: account.id, label: account.label, removed: true }, () => [
        `✓ Removed account ${chalk.dim(`id:${account.id}`)}  ${account.label}`,
    ])

    const clearResult = store.getLastClearResult()
    if (clearResult) {
        logTokenStorageResult(
            clearResult,
            'Stored token removed from the system credential manager',
            options.json || options.ndjson,
        )
    }
}

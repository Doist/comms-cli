import { attachLogoutCommand } from '@doist/cli-core/auth'
import type { Command } from 'commander'
import type { CommsAccount, CommsTokenStore } from '../../lib/auth-provider.js'
import { logStoredTokenRemoval } from './helpers.js'

/**
 * Attach `tdc auth logout` via cli-core's generic `attachLogoutCommand`. The
 * registrar emits the success line (`✓ Logged out` / `{ok:true}` / silent
 * ndjson); `onCleared` only surfaces the keyring-fallback warning carried by
 * `TokenStorageResult` — cli-core's `TokenStore.clear: void` contract can't
 * expose it directly, so we stash it on the adapter (`getLastClearResult`).
 */
export function attachCommsLogoutCommand(auth: Command, store: CommsTokenStore): Command {
    return attachLogoutCommand<CommsAccount>(auth, {
        store,
        onCleared: ({ view }) => logStoredTokenRemoval(store, view),
    })
}

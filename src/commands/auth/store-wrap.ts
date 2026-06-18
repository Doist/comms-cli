import type { AccountRef } from '@doist/cli-core/auth'
import { findAccountInStore, type CommsTokenStore } from '../../lib/auth-provider.js'

// Bridge the global `tdc --user <ref>` (stripped by `src/index.ts`) into
// cli-core's attachers, which only see per-command `--user`. Explicit ref
// passed by commander wins over the captured global ref.
//
// `active()` / `activeBundle()` pass the substituted ref straight through — cli-core's
// `KeyringTokenStore.active` returns `null` on a miss, which the attachers
// surface via `onNotAuthenticated` (status / token view). Bundle-aware attachers
// like `refresh-token view` need the same substitution. `clear()` does the extra
// existence check first via `findAccountInStore`, because cli-core's
// `KeyringTokenStore.clear` is a silent no-op on a non-matching ref and
// would otherwise let `tdc --user <wrong> auth logout` print `✓ Logged out`.
export function withUserRefAware(
    store: CommsTokenStore,
    requestedRef: AccountRef | undefined,
): CommsTokenStore {
    return Object.assign(Object.create(store) as CommsTokenStore, {
        active: (ref?: AccountRef) => store.active(ref ?? requestedRef),
        activeBundle: (ref?: AccountRef) => store.activeBundle(ref ?? requestedRef),
        clear: async (ref?: AccountRef) => {
            if (ref === undefined && requestedRef !== undefined) {
                const account = await findAccountInStore(store, requestedRef)
                return store.clear(account.id)
            }
            return store.clear(ref)
        },
    })
}

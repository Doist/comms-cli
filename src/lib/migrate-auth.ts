import { type MigrateAuthResult, migrateLegacyAuth } from '@doist/cli-core/auth'
import { CommsApi } from '@doist/comms-sdk'
import { LEGACY_KEYRING_ACCOUNT, SECURE_STORE_SERVICE } from './auth-constants.js'
import type { CommsAccount } from './auth-provider.js'
import { getConfig, updateConfig } from './config.js'
import { toCommsAccount } from './comms-account.js'
import { createCommsUserRecordStore } from './user-records.js'

/**
 * Pinned to this migration's target schema. Decoupled from the exported
 * `CONFIG_VERSION` so a future bump doesn't make this helper re-run for
 * users who are already on v2 or beyond.
 */
const V2_SCHEMA_VERSION = 2

/**
 * One-time migration of v1 auth state into the v2 `users[]` shape. Called
 * by postinstall and by the lazy hook in `createCommsTokenStore`. Idempotent
 * via the `config_version` marker.
 *
 * Uses raw `CommsApi` rather than `createWrappedCommsClient` to keep this
 * module out of the runtime auth/token-store import graph.
 */
export async function runMigrateLegacyAuth(
    options: { silent: boolean } = { silent: true },
): Promise<MigrateAuthResult<CommsAccount>> {
    return migrateLegacyAuth<CommsAccount>({
        serviceName: SECURE_STORE_SERVICE,
        legacyAccount: LEGACY_KEYRING_ACCOUNT,
        userRecords: createCommsUserRecordStore(),
        hasMigrated: async () => {
            const config = await getConfig()
            return (config.config_version ?? 0) >= V2_SCHEMA_VERSION
        },
        markMigrated: async () => {
            await updateConfig({ config_version: V2_SCHEMA_VERSION })
        },
        loadLegacyPlaintextToken: async () => {
            const config = await getConfig()
            return config.token?.trim() || null
        },
        identifyAccount: async (token) => {
            const [user, config] = await Promise.all([
                new CommsApi(token).users.getSessionUser(),
                getConfig(),
            ])
            return toCommsAccount(user, {
                authMode: config.authMode,
                authScope: config.authScope,
            })
        },
        cleanupLegacyConfig: async () => {
            await updateConfig({
                token: undefined,
                authMode: undefined,
                authScope: undefined,
                authUserId: undefined,
                authUserName: undefined,
                pendingSecureStoreClear: undefined,
            })
        },
        silent: options.silent,
        logPrefix: 'comms-cli',
    })
}

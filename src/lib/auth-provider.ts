import {
    type AccountRef,
    type AuthAccount,
    type AuthProvider,
    createDcrProvider,
    createKeyringTokenStore,
    type KeyringTokenStore,
} from '@doist/cli-core/auth'
import { createWrappedCommsClient } from './api.js'
import { SECURE_STORE_SERVICE } from './auth-constants.js'
import { toCommsAccount } from './comms-account.js'
import { type AuthMode, getConfig, getConfigPath } from './config.js'
import { CliError } from './errors.js'
import { parseRef } from './refs.js'
import { createCommsUserRecordStore, getDefaultUserRecord } from './user-records.js'

export const AUTHORIZATION_URL = 'https://comms.todoist.com/oauth/authorize'
export const TOKEN_URL = 'https://comms.todoist.com/oauth/access_token'
export const REGISTRATION_URL = 'https://comms.todoist.com/oauth/register'

const LOGO_URI = 'https://raw.githubusercontent.com/doist/comms-cli/main/icons/comms-cli.png'

export const READ_WRITE_SCOPES = [
    'user:read',
    'user:write',
    'workspaces:read',
    'channels:read',
    'channels:write',
    'channels:remove',
    'threads:read',
    'threads:write',
    'comments:read',
    'comments:write',
    'messages:read',
    'messages:write',
    'reactions:read',
    'reactions:write',
    'groups:read',
    'groups:write',
    'groups:remove',
    'search:read',
    'notifications:read',
    'attachments:read',
    'attachments:write',
]

export const READ_ONLY_SCOPES = [
    'user:read',
    'workspaces:read',
    'channels:read',
    'threads:read',
    'comments:read',
    'messages:read',
    'reactions:read',
    'groups:read',
    'search:read',
    'notifications:read',
    'attachments:read',
]

const AUTH_HINTS = ['Try again: tdc auth login', 'Or set COMMS_API_TOKEN environment variable']

/**
 * The scope set a login is granted, as a pure function of `--read-only`. Single
 * source of truth shared by `attachCommsLoginCommand`'s `resolveScopes` (what we
 * request at authorize) and the provider's `validate` (what we record on the
 * account), so the two can't drift.
 */
export function getScopes(readOnly: boolean): string[] {
    return readOnly ? READ_ONLY_SCOPES : READ_WRITE_SCOPES
}

/**
 * Narrow account shape: only fields that round-trip through the local token
 * store. `id` is the stringified numeric Comms user id (so cli-core's
 * `AuthAccount.id` string contract holds), `label` is the user's display
 * name. Richer session-user details are fetched on demand via the API
 * rather than threaded through the auth flow.
 */
export type CommsAccount = AuthAccount & {
    id: string
    label: string
    authMode: AuthMode
    authScope: string
}

export type CommsTokenStore = KeyringTokenStore<CommsAccount>

/**
 * Sentinel for the `{ id: '', label: '' }` snapshot that `tdc auth token`
 * persists when the user passes a raw token with no identity attached. The
 * empty-id/empty-label pair is the contract between `loginWithToken` (writer)
 * and `account current` / `account list` (readers); centralise it here so
 * each call site agrees on the shape.
 */
export const MANUAL_TOKEN_ACCOUNT: CommsAccount = {
    id: '',
    label: '',
    authMode: 'unknown',
    authScope: '',
}

/** True when `account` is the identity-less snapshot produced by `tdc auth token`. */
export function isManualTokenAccount(account: Pick<CommsAccount, 'id' | 'label'>): boolean {
    return !account.id || !account.label
}

/**
 * Comms's OAuth flow uses RFC 7591 Dynamic Client Registration: each login
 * mints a fresh `client_id` / `client_secret`, then runs the standard PKCE
 * authorize + token exchange. cli-core's `createDcrProvider` drives all of that
 * via `oauth4webapi`; the only comms-specific piece is `validate`, which probes
 * `getSessionUser` and records the auth mode/scope the login was granted.
 *
 * `authMode` / `authScope` are derived from `handshake.readOnly` (folded in by
 * `runOAuthFlow`) rather than threaded through `authorize`, because the scope
 * set is itself a pure function of `readOnly` (see `resolveScopes` in login.ts).
 */
export function createCommsAuthProvider(): AuthProvider<CommsAccount> {
    return createDcrProvider<CommsAccount>({
        registrationUrl: REGISTRATION_URL,
        authorizeUrl: AUTHORIZATION_URL,
        tokenUrl: TOKEN_URL,
        clientMetadata: {
            clientName: 'Comms CLI',
            clientUri: 'https://github.com/doist/comms-cli',
            logoUri: LOGO_URI,
            applicationType: 'native',
            // Comms client_ids can contain `_`. oauth4webapi's
            // `client_secret_basic` form-url-encodes the Basic credential per
            // RFC 6749 §2.3.1 (`_` → `%5F`), and the token endpoint doesn't
            // url-decode it, so the lookup fails with "client_id not found".
            // `client_secret_post` sends the credential in the body via
            // URLSearchParams, which preserves `_`, sidestepping the mismatch.
            tokenEndpointAuthMethod: 'client_secret_post',
        },
        errorHints: AUTH_HINTS,
        async validate({ token, handshake }) {
            // `runOAuthFlow` folds a boolean `readOnly` into the handshake.
            // Fail closed on a missing/malformed value rather than letting
            // `Boolean(undefined)` silently grant read-write (which would relax
            // the local write guard).
            const readOnly = handshake.readOnly
            if (typeof readOnly !== 'boolean') {
                throw new CliError(
                    'AUTH_FAILED',
                    'Internal: auth handshake missing the readOnly flag.',
                    AUTH_HINTS,
                )
            }
            const client = createWrappedCommsClient(token)
            const user = await client.users.getSessionUser()
            return toCommsAccount(user, {
                authMode: readOnly ? 'read-only' : 'read-write',
                authScope: getScopes(readOnly).join(' '),
            })
        },
    })
}

/**
 * Accepts `42`, `id:42`, and case-insensitive labels — `parseRef` normalises
 * the numeric forms. Broader than cli-core's default strict-equality matcher.
 */
export function matchCommsAccount(account: CommsAccount, ref: AccountRef): boolean {
    // Identity-less manual-token snapshots (empty id + label) are never a valid
    // ref target — they're hidden from `account list` and can't be `use`d /
    // `remove`d. Guard here so an empty-ish ref (`""`, `id:`) can't resolve to
    // one through the keyring store's ref matching.
    if (isManualTokenAccount(account)) return false
    const parsed = parseRef(ref)
    if (parsed.type === 'id') return account.id === parsed.id
    if (parsed.type === 'name') return account.label.toLowerCase() === parsed.name.toLowerCase()
    return false
}

const TOKEN_ENV_VAR = 'COMMS_API_TOKEN'

/**
 * The `COMMS_API_TOKEN` env override that takes precedence over the keyring
 * store, or `null` to defer to it. Only applies when no explicit ref is
 * supplied — an explicit ref means the caller targets a specific stored
 * account. Shared by the store's `active()` and `activeBundle()` so the two
 * reads can't diverge.
 */
function resolveEnvOverride(ref?: AccountRef): { token: string; account: CommsAccount } | null {
    if (ref === undefined) {
        const envToken = process.env[TOKEN_ENV_VAR]
        if (envToken) return { token: envToken, account: MANUAL_TOKEN_ACCOUNT }
    }
    return null
}

/**
 * Resolve a `ref` against the local store, returning the canonical account.
 * Throws `ACCOUNT_NOT_FOUND` on a miss. Shared between the `tdc account ...`
 * commands and `withUserRefAware` so the same hint reaches every caller.
 */
export async function findAccountInStore(
    store: CommsTokenStore,
    ref: AccountRef,
): Promise<CommsAccount> {
    const records = await store.list()
    // Manual-token snapshots have no id/label and can't be the target of a
    // ref-based command. Excluding them here keeps `tdc account use|remove`
    // honest with what `tdc account list` shows.
    const match = records
        .filter(({ account }) => !isManualTokenAccount(account))
        .find(({ account }) => matchCommsAccount(account, ref))
    if (!match) {
        throw new CliError('ACCOUNT_NOT_FOUND', `No stored account matches "${ref}".`, [
            'Run: tdc account list',
        ])
    }
    return match.account
}

/**
 * `COMMS_API_TOKEN` short-circuits `active()` only when no explicit ref is
 * supplied — cli-core's `KeyringTokenStore` doesn't know about the env var,
 * and an explicit ref means the caller targets a specific stored account.
 */
export function createCommsTokenStore(): CommsTokenStore {
    const inner = createKeyringTokenStore<CommsAccount>({
        serviceName: SECURE_STORE_SERVICE,
        userRecords: createCommsUserRecordStore(),
        recordsLocation: getConfigPath(),
        matchAccount: matchCommsAccount,
    })
    return Object.assign(Object.create(inner) as CommsTokenStore, {
        async active(ref?: AccountRef) {
            return resolveEnvOverride(ref) ?? inner.active(ref)
        },
        // Mirror `active()`: cli-core's auth commands read the live credential
        // through `activeBundle()` (it carries the refresh slot too), so the
        // env-token fallback must apply here as well or `tdc auth status` would
        // report no token for env-token sessions.
        async activeBundle(ref?: AccountRef) {
            const override = resolveEnvOverride(ref)
            if (override) {
                return { account: override.account, bundle: { accessToken: override.token } }
            }
            return inner.activeBundle(ref)
        },
        // cli-core's `account current` resolves through `activeAccount()`. An
        // env-token session isn't a v2 store account, so report `null` — the
        // attacher then routes to its `onNotAuthenticated` hook, which renders
        // the env notice. (A manual-token snapshot stays a real store account;
        // `account current` special-cases it in its renderers.)
        async activeAccount(ref?: AccountRef) {
            if (resolveEnvOverride(ref)) return null
            return inner.activeAccount(ref)
        },
        async set(account: CommsAccount, token: string) {
            return inner.set(account, token)
        },
        async clear(ref?: AccountRef) {
            return inner.clear(ref)
        },
        async list() {
            return inner.list()
        },
        async setDefault(ref: AccountRef) {
            return inner.setDefault(ref)
        },
    })
}

/**
 * Where the currently-active token lives. Returns `'config-file'` whenever
 * a plaintext token is on disk so doctor/config-view reports the
 * security-relevant state accurately.
 */
export async function getActiveTokenSource(): Promise<'env' | 'secure-store' | 'config-file'> {
    if (process.env[TOKEN_ENV_VAR]) return 'env'
    const config = await getConfig()
    const record = getDefaultUserRecord(config)
    if (record?.fallbackToken) return 'config-file'
    return 'secure-store'
}

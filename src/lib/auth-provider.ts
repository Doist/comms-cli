import {
    type AccountRef,
    type AuthAccount,
    type AuthProvider,
    createDcrProvider,
    createKeyringTokenStore,
    type DcrRegisteredClient,
    type ExchangeInput,
    type ExchangeResult,
    type KeyringTokenStore,
    type PrepareInput,
    type RefreshInput,
    type TokenBundle,
    type ValidateInput,
} from '@doist/cli-core/auth'
import { createWrappedCommsClient } from './api.js'
import { SECURE_STORE_SERVICE } from './auth-constants.js'
import { makeCommsAccount, toCommsAccount } from './comms-account.js'
import {
    type AuthMode,
    getConfig,
    getConfigPath,
    type StoredOAuthClient,
    updateConfig,
} from './config.js'
import { CliError } from './errors.js'
import { parseRef } from './refs.js'
import { splitScopeString } from './scopes.js'
import { createCommsUserRecordStore, getDefaultUserRecord } from './user-records.js'

const DEFAULT_TODOIST_AUTH_BASE_URL = 'https://todoist.com'
const DEFAULT_COMMS_OAUTH_RESOURCE = 'https://comms.todoist.com'

const LOGO_URI = 'https://raw.githubusercontent.com/doist/comms-cli/main/icons/comms-cli.png'

export const READ_ONLY_SCOPES = [
    'user:read',
    'workspaces:read',
    'comms:channels:read',
    'comms:content:read',
    'comms:messages:read',
]

const DEFAULT_WRITE_SCOPES = ['comms:content:write', 'comms:messages:write']

const FULL_ACCESS_EXTRA_SCOPES = [
    'user:write',
    'workspaces:write',
    'comms:channels:write',
    'comms:channels:delete',
    'comms:content:delete',
    'comms:messages:delete',
]

export const READ_WRITE_SCOPES = [...READ_ONLY_SCOPES, ...DEFAULT_WRITE_SCOPES]

export const FULL_ACCESS_SCOPES = [...READ_WRITE_SCOPES, ...FULL_ACCESS_EXTRA_SCOPES]

const AUTH_HINTS = ['Try again: tdc auth login', 'Or set COMMS_API_TOKEN environment variable']

const WRITE_SCOPES = new Set([...DEFAULT_WRITE_SCOPES, ...FULL_ACCESS_EXTRA_SCOPES])
const MAX_CACHED_OAUTH_CLIENTS = 25

/**
 * Single source of truth shared by `attachCommsLoginCommand`'s `resolveScopes`
 * (what we request at authorize) and the provider's token-response fallback
 * (what we record on the account), so the two can't drift.
 */
export function getScopes({
    readOnly,
    fullAccess = false,
}: {
    readOnly: boolean
    fullAccess?: boolean
}): string[] {
    if (readOnly) return READ_ONLY_SCOPES
    return fullAccess ? FULL_ACCESS_SCOPES : READ_WRITE_SCOPES
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
    oauthClientId?: string
    authBaseUrl?: string
    authResource?: string
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

export type CommsOAuthConfig = {
    authBaseUrl: string
    authorizationUrl: string
    tokenUrl: string
    registrationUrl: string
    resource: string
}

/**
 * Todoist is the OAuth authorization server; Comms is the protected resource.
 * The CLI registers as a public DCR client (PKCE, no client secret) and pins
 * tokens to the Comms resource via the RFC 8707 `resource` indicator. The
 * registration / authorize / token-exchange / refresh mechanics all live in
 * cli-core's `createDcrProvider`; the Comms-specific behaviour is:
 *
 *  - endpoint + resource resolution from `COMMS_BASE_URL` / `COMMS_AS_URL`
 *    (see `getCommsOAuthResource` / `getTodoistAuthBaseUrl`),
 *  - caching the registered `client_id` in config (`loadClient` / `saveClient`),
 *  - recording the server-granted scope on the account (the `exchangeCode`
 *    wrapper stashes it on the handshake for `validate`; `refreshToken`
 *    refreshes it), and
 *  - `validate`: probe `getSessionUser`, derive `authMode` from the granted
 *    scope, and build the `CommsAccount`.
 */
export function createCommsAuthProvider(
    fetchImpl: typeof fetch = fetch,
): AuthProvider<CommsAccount> {
    const base = createDcrProvider<CommsAccount>({
        registrationUrl: ({ handshake }) => getOAuthConfigForHandshake(handshake).registrationUrl,
        authorizeUrl: ({ handshake }) => getOAuthConfigForHandshake(handshake).authorizationUrl,
        tokenUrl: ({ handshake }) => getOAuthConfigForHandshake(handshake).tokenUrl,
        resource: ({ handshake }) => getOAuthConfigForHandshake(handshake).resource,
        clientMetadata: {
            clientName: 'Comms CLI',
            clientUri: 'https://github.com/doist/comms-cli',
            logoUri: LOGO_URI,
            tokenEndpointAuthMethod: 'none',
            grantTypes: ['authorization_code', 'refresh_token'],
            responseTypes: ['code'],
            // DCR scope is the upper bound this public client may request.
            // Per-login authorize scopes are still narrowed by `resolveScopes`;
            // keeping registration broad lets one cached client serve read-only,
            // default, and full-access logins.
            extra: { scope: FULL_ACCESS_SCOPES.join(' ') },
        },
        loadClient: loadCachedClient,
        saveClient: saveCachedClient,
        validate: validateCommsToken,
        errorHints: AUTH_HINTS,
        fetchImpl,
    })

    return {
        ...base,
        async exchangeCode(input: ExchangeInput): Promise<ExchangeResult<CommsAccount>> {
            const exchange = await base.exchangeCode(input)
            // cli-core threads this same handshake object into `validateToken`
            // next, so stash the server-granted scope (so `validate` records the
            // authoritative scope) and the token-response diagnostics (so a
            // Comms rejection can explain what Todoist actually issued).
            if (exchange.scope) input.handshake.grantedScope = exchange.scope
            input.handshake.tokenDiagnostics = describeTokenResponse(exchange)
            return exchange
        },
        async refreshToken(input: RefreshInput): Promise<ExchangeResult<CommsAccount>> {
            const exchange = await base.refreshToken!(input)
            const grantedScope =
                exchange.scope ?? optionalHandshakeString(input.handshake, 'authScope')
            const account = grantedScope
                ? buildRefreshAccount(input.handshake, grantedScope)
                : undefined
            return account ? { ...exchange, account } : exchange
        },
    }
}

/**
 * Probe `getSessionUser` to confirm the token works, then build a
 * `CommsAccount`. Granted scope comes from the server (stashed on the
 * handshake by `exchangeCode`); it falls back to the requested scope set when
 * the token endpoint didn't echo one.
 */
async function validateCommsToken({ token, handshake }: ValidateInput): Promise<CommsAccount> {
    const readOnly = requireHandshakeReadOnly(handshake)
    const grantedScope =
        optionalHandshakeString(handshake, 'grantedScope') ??
        getScopes({ readOnly, fullAccess: isFullAccessHandshake(handshake) }).join(' ')
    const authMode = getAuthModeForGrantedScope(grantedScope)
    const config = getOAuthConfigForHandshake(handshake)
    const client = createWrappedCommsClient(token, { baseUrl: config.resource })
    let user
    try {
        user = await client.users.getSessionUser()
    } catch (error) {
        if (hasErrorCode(error, 'FORBIDDEN')) {
            const diagnostics = Array.isArray(handshake.tokenDiagnostics)
                ? (handshake.tokenDiagnostics as string[])
                : []
            throw new CliError('AUTH_FAILED', 'Comms rejected the OAuth token during validation.', [
                ...diagnostics,
                'Check Comms logs for Todoist OAuth introspection: active, aud, exp, scope, user_id/sub',
            ])
        }
        throw error
    }
    return toCommsAccount(user, {
        authMode,
        authScope: normalizeScopeString(grantedScope),
        oauthClientId: requireHandshakeString(handshake, 'clientId', 'AUTH_FAILED'),
        authBaseUrl: config.authBaseUrl,
        authResource: config.resource,
    })
}

/**
 * Rebuild the rotated `CommsAccount` after a refresh so the stored
 * `authScope` / `authMode` track the (possibly changed) granted scope. Returns
 * `undefined` when the refresh handshake lacks the identity fields, leaving the
 * previously-stored account in place.
 */
function buildRefreshAccount(
    handshake: Record<string, unknown>,
    grantedScope: string,
): CommsAccount | undefined {
    const id = optionalHandshakeString(handshake, 'accountId')
    const label = optionalHandshakeString(handshake, 'accountLabel')
    const clientId = optionalHandshakeString(handshake, 'clientId')
    if (!id || !label || !clientId) return undefined

    const config = getOAuthConfigForHandshake(handshake)
    return makeCommsAccount({
        id,
        label,
        authMode: getAuthModeForGrantedScope(grantedScope),
        authScope: normalizeScopeString(grantedScope),
        oauthClientId: clientId,
        authBaseUrl: config.authBaseUrl,
        authResource: config.resource,
    })
}

/**
 * The handshake `refreshAccessToken` forwards to the provider's
 * `refreshToken`. cli-core doesn't persist the DCR handshake, so we
 * reconstruct it from the stored account: `clientId` (read by cli-core's
 * refresh grant), the resource / auth base URL (read by the endpoint
 * resolvers), and the identity fields (read by `buildRefreshAccount`).
 */
export function getCommsOAuthRefreshHandshake(account: CommsAccount): Record<string, unknown> {
    if (!account.oauthClientId || !account.authBaseUrl || !account.authResource) {
        throw new CliError(
            'NO_TOKEN',
            'Stored OAuth token cannot be refreshed because its client metadata is missing.',
            ['Run: tdc auth login'],
        )
    }
    return {
        clientId: account.oauthClientId,
        accountId: account.id,
        accountLabel: account.label,
        authScope: account.authScope,
        authBaseUrl: account.authBaseUrl,
        resource: account.authResource,
    }
}

/** Endpoint + resource config derived from the environment (login path). */
function getCommsOAuthConfig(): CommsOAuthConfig {
    const resource = getCommsOAuthResource()
    return buildCommsOAuthConfig(getTodoistAuthBaseUrl(resource), resource)
}

/**
 * Endpoint + resource config for a provider hook. Prefers values carried on
 * the handshake (the refresh path reconstructs them from the stored account)
 * and falls back to the environment (the login path, where the handshake
 * doesn't carry them).
 */
function getOAuthConfigForHandshake(handshake: Record<string, unknown>): CommsOAuthConfig {
    const resource = optionalHandshakeString(handshake, 'resource') ?? getCommsOAuthResource()
    const authBaseUrl =
        optionalHandshakeString(handshake, 'authBaseUrl') ?? getTodoistAuthBaseUrl(resource)
    return buildCommsOAuthConfig(authBaseUrl, resource)
}

function buildCommsOAuthConfig(authBaseUrl: string, resource: string): CommsOAuthConfig {
    return {
        authBaseUrl,
        authorizationUrl: `${authBaseUrl}/oauth/authorize`,
        tokenUrl: `${authBaseUrl}/oauth/access_token`,
        registrationUrl: `${authBaseUrl}/oauth/register`,
        resource,
    }
}

/**
 * `loadClient` hook: reuse a registered `client_id` cached in config for the
 * current auth server + resource + redirect URI. Keying on `redirectUri` is
 * required — the registration is bound to its `redirect_uris` and the callback
 * port can change between logins.
 */
async function loadCachedClient(input: PrepareInput): Promise<DcrRegisteredClient | undefined> {
    const config = getCommsOAuthConfig()
    const { oauthClients } = await getConfig()
    const cached = (Array.isArray(oauthClients) ? oauthClients : [])
        .filter(isStoredOAuthClient)
        .find(
            (client) =>
                client.authBaseUrl === config.authBaseUrl &&
                client.authResource === config.resource &&
                client.redirectUri === input.redirectUri,
        )
    return cached ? { clientId: cached.clientId } : undefined
}

/** `saveClient` hook: persist a freshly registered public client for reuse. */
async function saveCachedClient(client: DcrRegisteredClient, input: PrepareInput): Promise<void> {
    const config = getCommsOAuthConfig()
    const entry: StoredOAuthClient = {
        clientId: client.clientId,
        authBaseUrl: config.authBaseUrl,
        authResource: config.resource,
        redirectUri: input.redirectUri,
    }
    const stored = await getConfig()
    const existing = (Array.isArray(stored.oauthClients) ? stored.oauthClients : [])
        .filter(isStoredOAuthClient)
        .filter(
            (other) =>
                other.authBaseUrl !== entry.authBaseUrl ||
                other.authResource !== entry.authResource ||
                other.redirectUri !== entry.redirectUri,
        )
    await updateConfig({
        oauthClients: [...existing, entry].slice(-MAX_CACHED_OAUTH_CLIENTS),
    })
}

function isStoredOAuthClient(value: unknown): value is StoredOAuthClient {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (
        typeof record.clientId === 'string' &&
        typeof record.authBaseUrl === 'string' &&
        typeof record.authResource === 'string' &&
        typeof record.redirectUri === 'string'
    )
}

function getCommsOAuthResource(): string {
    const override = process.env.COMMS_BASE_URL
    if (!override) return DEFAULT_COMMS_OAUTH_RESOURCE

    let url: URL
    try {
        url = new URL(override)
    } catch {
        throw new CliError('INVALID_URL', `COMMS_BASE_URL is not a valid URL: ${override}`, [
            'Use a URL like https://comms.todoist.com',
            'Or unset COMMS_BASE_URL before running OAuth login',
        ])
    }
    if (url.protocol !== 'https:') {
        throw new CliError('INVALID_URL', 'Todoist OAuth requires an HTTPS Comms resource.', [
            'Use https://comms.todoist.com, https://comms.staging.todoist.com, or https://comms.local.todoist.com',
        ])
    }
    const origin = url.origin
    const host = url.hostname.toLowerCase()
    if (
        host === 'comms.todoist.com' ||
        host === 'comms.staging.todoist.com' ||
        host === 'comms.local.todoist.com'
    ) {
        return origin
    }
    throw new CliError('INVALID_URL', `Unsupported Comms OAuth resource: ${origin}`, [
        'Use COMMS_API_TOKEN for custom Comms hosts',
        'Supported OAuth hosts: comms.todoist.com, comms.staging.todoist.com, comms.local.todoist.com',
    ])
}

function getTodoistAuthBaseUrl(resource: string): string {
    const override = process.env.COMMS_AS_URL
    if (override) return normalizeAuthBaseUrlOverride(override)

    const host = new URL(resource).hostname.toLowerCase()
    if (host === 'comms.staging.todoist.com') return 'https://staging.todoist.com'
    if (host === 'comms.local.todoist.com') return 'https://local.todoist.com'
    return DEFAULT_TODOIST_AUTH_BASE_URL
}

function normalizeAuthBaseUrlOverride(raw: string): string {
    let url: URL
    try {
        url = new URL(raw)
    } catch {
        throw new CliError('INVALID_URL', `COMMS_AS_URL is not a valid URL: ${raw}`, [
            'Use a URL like https://todoist.com',
        ])
    }
    if (url.protocol !== 'https:') {
        throw new CliError('INVALID_URL', 'COMMS_AS_URL must use HTTPS.', [
            'Use a URL like https://todoist.com',
        ])
    }
    const host = url.hostname.toLowerCase()
    if (host !== 'todoist.com' && !host.endsWith('.todoist.com')) {
        throw new CliError('INVALID_URL', 'COMMS_AS_URL must point to a Todoist host.', [
            'Use a URL like https://todoist.com or https://staging.todoist.com',
        ])
    }
    return url.origin
}

function requireHandshakeString(
    handshake: Record<string, unknown>,
    key: string,
    code = 'AUTH_TOKEN_EXCHANGE_FAILED',
): string {
    const value = handshake[key]
    if (typeof value !== 'string' || value.length === 0) {
        throw new CliError(code, `Internal: OAuth handshake missing ${key}.`, [
            'Try again: tdc auth login',
        ])
    }
    return value
}

function optionalHandshakeString(
    handshake: Record<string, unknown>,
    key: string,
): string | undefined {
    const value = handshake[key]
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requireHandshakeReadOnly(handshake: Record<string, unknown>): boolean {
    if (typeof handshake.readOnly !== 'boolean') {
        throw new CliError(
            'AUTH_FAILED',
            'Internal: auth handshake missing the readOnly flag.',
            AUTH_HINTS,
        )
    }
    return handshake.readOnly
}

/** Read the `--full-access` flag from the runtime flags folded onto the handshake. */
function isFullAccessHandshake(handshake: Record<string, unknown>): boolean {
    const flags = handshake.flags
    return (
        typeof flags === 'object' &&
        flags !== null &&
        (flags as Record<string, unknown>).fullAccess === true
    )
}

function hasErrorCode(error: unknown, code: string): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code === code
    )
}

/**
 * Operator-facing hints describing what Todoist's token endpoint actually
 * issued — surfaced only when Comms later rejects the token during `validate`.
 * Reconstructed from the `ExchangeResult` (cli-core's DCR exchange surfaces the
 * access token, refresh-token presence, and granted scope).
 */
function describeTokenResponse(exchange: ExchangeResult<CommsAccount>): string[] {
    const hints = [
        `Todoist token response: refresh_token=${exchange.refreshToken ? 'yes' : 'no'}`,
        `Todoist token response access_token: ${describeAccessTokenShape(exchange.accessToken)}`,
    ]
    if (exchange.scope) hints.push(`Todoist token response scope: ${exchange.scope}`)
    if (!exchange.refreshToken) {
        hints.push(
            'Todoist issued a non-refresh access token; Comms intentionally rejects tokens without expiring introspection.',
        )
    }
    return hints
}

function describeAccessTokenShape(accessToken: string): string {
    const shape = /^[0-9a-f]{40}$/.test(accessToken) ? 'raw-hex-40' : 'other'
    return `shape=${shape}, length=${accessToken.length}`
}

function getAuthModeForGrantedScope(scope: string): AuthMode {
    return splitScopeString(scope).some((scopeCode) => WRITE_SCOPES.has(scopeCode))
        ? 'read-write'
        : 'read-only'
}

function normalizeScopeString(scope: string): string {
    return splitScopeString(scope).join(' ')
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
        async setBundle(
            account: CommsAccount,
            bundle: TokenBundle,
            options?: { promoteDefault?: boolean },
        ) {
            return inner.setBundle(account, bundle, options)
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
    if (record?.fallbackToken || record?.fallbackRefreshToken) return 'config-file'
    return 'secure-store'
}

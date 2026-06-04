import {
    type AccountRef,
    type AuthAccount,
    type AuthProvider,
    createKeyringTokenStore,
    deriveChallenge,
    generateVerifier,
    type KeyringTokenStore,
    type TokenBundle,
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
import { createCommsUserRecordStore, getDefaultUserRecord } from './user-records.js'

const DEFAULT_TODOIST_AUTH_BASE_URL = 'https://todoist.com'
const DEFAULT_COMMS_OAUTH_RESOURCE = 'https://comms.todoist.com'

const LOGO_URI =
    'https://raw.githubusercontent.com/Doist/comms-cli/d65c447ff453eb36af585044c2f5f2f602bcdb34/icons/comms-cli.png'

export const READ_WRITE_SCOPES = [
    'user:read',
    'workspaces:read',
    'comms:channels:read',
    'comms:content:read',
    'comms:content:write',
    'comms:messages:read',
    'comms:messages:write',
]

export const READ_ONLY_SCOPES = [
    'user:read',
    'workspaces:read',
    'comms:channels:read',
    'comms:content:read',
    'comms:messages:read',
]

export const FULL_ACCESS_SCOPES = [
    'user:read',
    'user:write',
    'workspaces:read',
    'workspaces:write',
    'comms:channels:read',
    'comms:channels:write',
    'comms:channels:delete',
    'comms:content:read',
    'comms:content:write',
    'comms:content:delete',
    'comms:messages:read',
    'comms:messages:write',
    'comms:messages:delete',
]

const AUTH_HINTS = ['Try again: tdc auth login', 'Or set COMMS_API_TOKEN environment variable']

const WRITE_SCOPES = new Set([
    'user:write',
    'workspaces:write',
    'comms:channels:write',
    'comms:channels:delete',
    'comms:content:write',
    'comms:content:delete',
    'comms:messages:write',
    'comms:messages:delete',
])
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

type RegistrationResponse = {
    client_id?: unknown
    token_endpoint_auth_method?: unknown
}

type TokenEndpointResponse = {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    scope?: unknown
}

/**
 * Todoist is the OAuth authorization server; Comms is the protected resource.
 * The CLI registers as a public DCR client and uses PKCE, so no client secret
 * has to be persisted for refresh grants.
 */
export function createCommsAuthProvider(
    fetchImpl: typeof fetch = fetch,
): AuthProvider<CommsAccount> {
    return {
        async prepare({ redirectUri }) {
            const config = getCommsOAuthConfig()
            const cachedClientId = await getCachedOAuthClientId(config, redirectUri)
            if (cachedClientId) {
                return {
                    handshake: {
                        ...config,
                        oauthClientId: cachedClientId,
                    },
                }
            }

            const payload = {
                client_name: 'Comms CLI',
                client_uri: 'https://github.com/doist/comms-cli',
                logo_uri: LOGO_URI,
                redirect_uris: [redirectUri],
                scope: FULL_ACCESS_SCOPES.join(' '),
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
            }
            const response = await postJson<RegistrationResponse>({
                url: config.registrationUrl,
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                errorCode: 'AUTH_DCR_FAILED',
                errorLabel: 'OAuth client registration',
                fetchImpl,
            })
            if (typeof response.client_id !== 'string' || !response.client_id) {
                throw new CliError(
                    'AUTH_DCR_FAILED',
                    'OAuth client registration response missing client_id.',
                    AUTH_HINTS,
                )
            }
            if (
                response.token_endpoint_auth_method !== undefined &&
                response.token_endpoint_auth_method !== 'none'
            ) {
                throw new CliError(
                    'AUTH_DCR_FAILED',
                    `OAuth server registered an unsupported token_endpoint_auth_method: ${String(
                        response.token_endpoint_auth_method,
                    )}.`,
                    AUTH_HINTS,
                )
            }
            await cacheOAuthClientRegistration({
                clientId: response.client_id,
                authBaseUrl: config.authBaseUrl,
                authResource: config.resource,
                redirectUri,
            })
            return {
                handshake: {
                    ...config,
                    oauthClientId: response.client_id,
                },
            }
        },
        async authorize({ redirectUri, state, scopes, readOnly, flags, handshake }) {
            const clientId = requireHandshakeString(handshake, 'oauthClientId')
            const config = getOAuthConfigFromHandshake(handshake)
            const verifier = generateVerifier()
            const challenge = deriveChallenge(verifier)
            const url = new URL(config.authorizationUrl)
            url.searchParams.set('response_type', 'code')
            url.searchParams.set('client_id', clientId)
            url.searchParams.set('redirect_uri', redirectUri)
            url.searchParams.set('state', state)
            url.searchParams.set('code_challenge', challenge)
            url.searchParams.set('code_challenge_method', 'S256')
            url.searchParams.set('resource', config.resource)
            if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '))
            return {
                authorizeUrl: url.toString(),
                handshake: {
                    ...handshake,
                    codeVerifier: verifier,
                    fullAccess: !readOnly && isFullAccessFlag(flags),
                },
            }
        },
        async exchangeCode({ code, redirectUri, handshake }) {
            const clientId = requireHandshakeString(handshake, 'oauthClientId')
            const verifier = requireHandshakeString(handshake, 'codeVerifier')
            const config = getOAuthConfigFromHandshake(handshake)
            const exchange = await exchangeToken(
                config.tokenUrl,
                new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: redirectUri,
                    client_id: clientId,
                    code_verifier: verifier,
                    resource: config.resource,
                }),
                fetchImpl,
            )
            handshake.grantedScope = getGrantedScope(exchange.scope, handshake)
            handshake.tokenResponseExpiresIn = exchange.expiresIn
            handshake.tokenResponseHasRefreshToken = Boolean(exchange.refreshToken)
            handshake.tokenResponseScope = exchange.scope
            handshake.tokenResponseAccessTokenShape = describeAccessTokenShape(exchange.accessToken)
            return exchange
        },
        async refreshToken({ refreshToken, handshake }) {
            const clientId = requireHandshakeString(handshake, 'oauthClientId')
            const config = getOAuthConfigFromHandshake(handshake)
            const exchange = await exchangeToken(
                config.tokenUrl,
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: clientId,
                    resource: config.resource,
                }),
                fetchImpl,
                'refresh',
            )
            const grantedScope = exchange.scope ?? optionalHandshakeString(handshake, 'authScope')
            const account = grantedScope ? buildRefreshAccount(handshake, grantedScope) : undefined
            return account ? { ...exchange, account } : exchange
        },
        async validateToken({ token, handshake }) {
            requireHandshakeReadOnly(handshake)
            const grantedScope = requireHandshakeString(handshake, 'grantedScope', 'AUTH_FAILED')
            const authMode = getAuthModeForGrantedScope(grantedScope)
            const config = getOAuthConfigFromHandshake(handshake)
            const client = createWrappedCommsClient(token, { baseUrl: config.resource })
            let user
            try {
                user = await client.users.getSessionUser()
            } catch (error) {
                if (hasErrorCode(error, 'FORBIDDEN')) {
                    throw new CliError(
                        'AUTH_FAILED',
                        'Comms rejected the OAuth token during validation.',
                        [
                            ...tokenResponseDiagnosticHints(handshake),
                            'Check Comms logs for Todoist OAuth introspection: active, aud, exp, scope, user_id/sub',
                        ],
                    )
                }
                throw error
            }
            return toCommsAccount(user, {
                authMode,
                authScope: grantedScope,
                oauthClientId: requireHandshakeString(handshake, 'oauthClientId'),
                authBaseUrl: config.authBaseUrl,
                authResource: config.resource,
            })
        },
    }
}

export function getCommsOAuthRefreshHandshake(account: CommsAccount): Record<string, unknown> {
    if (!account.oauthClientId || !account.authBaseUrl || !account.authResource) {
        throw new CliError(
            'NO_TOKEN',
            'Stored OAuth token cannot be refreshed because its client metadata is missing.',
            ['Run: tdc auth login'],
        )
    }
    const config = buildCommsOAuthConfig(account.authBaseUrl, account.authResource)
    return {
        ...config,
        oauthClientId: account.oauthClientId,
        accountId: account.id,
        accountLabel: account.label,
        authScope: account.authScope,
    }
}

function getCommsOAuthConfig(): CommsOAuthConfig {
    const resource = getCommsOAuthResource()
    return buildCommsOAuthConfig(getTodoistAuthBaseUrl(resource), resource)
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

function getOAuthConfigFromHandshake(handshake: Record<string, unknown>): CommsOAuthConfig {
    const authBaseUrl = requireHandshakeString(handshake, 'authBaseUrl')
    const resource = requireHandshakeString(handshake, 'resource')
    return {
        authBaseUrl,
        authorizationUrl: requireHandshakeString(handshake, 'authorizationUrl'),
        tokenUrl: requireHandshakeString(handshake, 'tokenUrl'),
        registrationUrl: requireHandshakeString(handshake, 'registrationUrl'),
        resource,
    }
}

async function getCachedOAuthClientId(
    config: CommsOAuthConfig,
    redirectUri: string,
): Promise<string | undefined> {
    const { oauthClients } = await getConfig()
    const cached = (Array.isArray(oauthClients) ? oauthClients : [])
        .filter(isStoredOAuthClient)
        .find(
            (client) =>
                client.authBaseUrl === config.authBaseUrl &&
                client.authResource === config.resource &&
                client.redirectUri === redirectUri,
        )
    return cached?.clientId
}

async function cacheOAuthClientRegistration(client: StoredOAuthClient): Promise<void> {
    const config = await getConfig()
    const existing = (Array.isArray(config.oauthClients) ? config.oauthClients : [])
        .filter(isStoredOAuthClient)
        .filter(
            (entry) =>
                entry.authBaseUrl !== client.authBaseUrl ||
                entry.authResource !== client.authResource ||
                entry.redirectUri !== client.redirectUri,
        )
    await updateConfig({
        oauthClients: [...existing, client].slice(-MAX_CACHED_OAUTH_CLIENTS),
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

function optionalHandshakeBoolean(
    handshake: Record<string, unknown>,
    key: string,
): boolean | undefined {
    const value = handshake[key]
    if (value === undefined) return undefined
    if (typeof value === 'boolean') return value
    throw new CliError('AUTH_FAILED', `Internal: OAuth handshake has invalid ${key}.`, AUTH_HINTS)
}

function optionalHandshakeNumber(
    handshake: Record<string, unknown>,
    key: string,
): number | undefined {
    const value = handshake[key]
    if (value === undefined) return undefined
    if (typeof value === 'number' && Number.isFinite(value)) return value
    throw new CliError('AUTH_FAILED', `Internal: OAuth handshake has invalid ${key}.`, AUTH_HINTS)
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

function isFullAccessFlag(flags: Record<string, unknown>): boolean {
    return flags.fullAccess === true
}

function getGrantedScope(scope: string | undefined, handshake: Record<string, unknown>): string {
    return (
        scope ??
        getScopes({
            readOnly: requireHandshakeReadOnly(handshake),
            fullAccess: optionalHandshakeBoolean(handshake, 'fullAccess') === true,
        }).join(' ')
    )
}

function buildRefreshAccount(
    handshake: Record<string, unknown>,
    grantedScope: string,
): CommsAccount | undefined {
    const id = optionalHandshakeString(handshake, 'accountId')
    const label = optionalHandshakeString(handshake, 'accountLabel')
    const oauthClientId = optionalHandshakeString(handshake, 'oauthClientId')
    if (!id || !label || !oauthClientId) return undefined

    const config = getOAuthConfigFromHandshake(handshake)
    return makeCommsAccount({
        id,
        label,
        authMode: getAuthModeForGrantedScope(grantedScope),
        authScope: normalizeScopeString(grantedScope),
        oauthClientId,
        authBaseUrl: config.authBaseUrl,
        authResource: config.resource,
    })
}

async function postJson<T>(input: {
    url: string
    body: string
    headers: Record<string, string>
    errorCode: string
    errorLabel: string
    fetchImpl: typeof fetch
}): Promise<T> {
    let response: Response
    try {
        response = await input.fetchImpl(input.url, {
            method: 'POST',
            headers: input.headers,
            body: input.body,
        })
    } catch (error) {
        throw new CliError(
            input.errorCode,
            `${input.errorLabel} request failed for ${input.url}: ${errorMessage(error)}`,
            AUTH_HINTS,
        )
    }
    if (!response.ok) {
        const detail = await safeReadText(response)
        throw new CliError(
            input.errorCode,
            `${input.errorLabel} returned HTTP ${response.status}.`,
            detail ? [...AUTH_HINTS, detail] : AUTH_HINTS,
        )
    }
    try {
        return (await response.json()) as T
    } catch (error) {
        throw new CliError(
            input.errorCode,
            `${input.errorLabel} returned non-JSON response: ${errorMessage(error)}`,
            AUTH_HINTS,
        )
    }
}

async function exchangeToken(
    tokenUrl: string,
    body: URLSearchParams,
    fetchImpl: typeof fetch,
    mode: 'login' | 'refresh' = 'login',
): Promise<{
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    expiresIn?: number
    scope?: string
}> {
    let response: Response
    try {
        response = await fetchImpl(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: body.toString(),
        })
    } catch (error) {
        throw new CliError(
            refreshErrorCode(mode),
            `Token endpoint request failed: ${errorMessage(error)}`,
            refreshHints(mode),
        )
    }
    if (!response.ok) {
        const detail = await safeReadText(response)
        const oauthError = parseOAuthError(detail)
        if (mode === 'refresh' && oauthError?.error === 'invalid_grant') {
            throw new CliError(
                'AUTH_REFRESH_EXPIRED',
                `Refresh token rejected: ${formatOAuthError(oauthError)}`,
                ['Re-run the login command to reauthorize.'],
            )
        }
        throw new CliError(
            refreshErrorCode(mode),
            `Token endpoint returned HTTP ${response.status}.`,
            detail ? [...refreshHints(mode), detail] : refreshHints(mode),
        )
    }

    let payload: TokenEndpointResponse
    try {
        payload = (await response.json()) as TokenEndpointResponse
    } catch (error) {
        throw new CliError(
            refreshErrorCode(mode),
            `Token endpoint returned non-JSON response: ${errorMessage(error)}`,
            refreshHints(mode),
        )
    }
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
        throw new CliError(
            refreshErrorCode(mode),
            'Token endpoint response missing access_token.',
            refreshHints(mode),
        )
    }
    return {
        accessToken: payload.access_token,
        refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
        expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
        expiresAt:
            typeof payload.expires_in === 'number'
                ? Date.now() + payload.expires_in * 1000
                : undefined,
        scope: typeof payload.scope === 'string' ? normalizeScopeString(payload.scope) : undefined,
    }
}

function tokenResponseDiagnosticHints(handshake: Record<string, unknown>): string[] {
    const expiresIn = optionalHandshakeNumber(handshake, 'tokenResponseExpiresIn')
    const hasRefreshToken = optionalHandshakeBoolean(handshake, 'tokenResponseHasRefreshToken')
    const scope = optionalHandshakeString(handshake, 'tokenResponseScope')
    const accessTokenShape = optionalHandshakeString(handshake, 'tokenResponseAccessTokenShape')
    const hints = [
        `Todoist token response: expires_in=${expiresIn ?? 'missing'}, refresh_token=${
            hasRefreshToken ? 'yes' : 'no'
        }`,
    ]
    if (accessTokenShape) {
        hints.push(`Todoist token response access_token: ${accessTokenShape}`)
    }
    if (scope) {
        hints.push(`Todoist token response scope: ${scope}`)
    }
    if (expiresIn === 315360000 || hasRefreshToken === false) {
        hints.push(
            'Todoist issued a non-refresh access token; Comms intentionally rejects tokens without expiring introspection.',
        )
    }
    return hints
}

function describeAccessTokenShape(accessToken: string): string {
    let shape = 'other'
    if (/^[0-9a-f]{40}$/.test(accessToken)) {
        shape = 'raw-hex-40'
    }
    return `shape=${shape}, length=${accessToken.length}`
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

function getAuthModeForGrantedScope(scope: string): AuthMode {
    return splitScopeString(scope).some((scopeCode) => WRITE_SCOPES.has(scopeCode))
        ? 'read-write'
        : 'read-only'
}

function normalizeScopeString(scope: string): string {
    return splitScopeString(scope).join(' ')
}

function splitScopeString(scope: string): string[] {
    return scope
        .replaceAll(',', ' ')
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
}

function refreshErrorCode(mode: 'login' | 'refresh'): string {
    return mode === 'refresh' ? 'AUTH_REFRESH_TRANSIENT' : 'AUTH_TOKEN_EXCHANGE_FAILED'
}

function refreshHints(mode: 'login' | 'refresh'): string[] {
    return mode === 'refresh' ? ['Try again.', ...AUTH_HINTS] : AUTH_HINTS
}

async function safeReadText(response: Response): Promise<string | undefined> {
    try {
        const text = (await response.text()).trim()
        return text.length > 0 ? text : undefined
    } catch {
        return undefined
    }
}

function parseOAuthError(
    detail: string | undefined,
): { error: string; errorDescription?: string } | null {
    if (!detail) return null
    try {
        const parsed = JSON.parse(detail) as unknown
        if (!parsed || typeof parsed !== 'object') return null
        const record = parsed as Record<string, unknown>
        if (typeof record.error !== 'string') return null
        return {
            error: record.error,
            errorDescription:
                typeof record.error_description === 'string' ? record.error_description : undefined,
        }
    } catch {
        return null
    }
}

function formatOAuthError(error: { error: string; errorDescription?: string }): string {
    return error.errorDescription ? `${error.error} (${error.errorDescription})` : error.error
}

function errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return String(error)
    const cause = (error as { cause?: unknown }).cause
    if (!cause || typeof cause !== 'object') return error.message

    const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined
    const message =
        'message' in cause && typeof cause.message === 'string' ? cause.message : undefined
    if (code && message) return `${error.message} (${code}: ${message})`
    if (message) return `${error.message} (${message})`
    return error.message
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

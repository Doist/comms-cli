import { getErrorMessage } from '@doist/cli-core'
import {
    type AccountRef,
    type AuthAccount,
    type AuthProvider,
    createKeyringTokenStore,
    deriveChallenge,
    generateVerifier,
    type KeyringTokenStore,
} from '@doist/cli-core/auth'
import { createWrappedCommsClient } from './api.js'
import { SECURE_STORE_SERVICE } from './auth-constants.js'
import { toCommsAccount } from './comms-account.js'
import { type AuthMode, getConfig, getConfigPath } from './config.js'
import { CliError } from './errors.js'
import { parseRef } from './refs.js'
import { createCommsUserRecordStore, getDefaultUserRecord } from './user-records.js'

export const AUTHORIZATION_URL = 'https://todoist.com/oauth/authorize'
export const TOKEN_URL = 'https://todoist.com/oauth/access_token'
export const REGISTRATION_URL = 'https://todoist.com/oauth/register'
export const OAUTH_RESOURCE = 'comms'

const OAUTH_REQUEST_TIMEOUT_MS = 30_000
const TODOIST_VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const LOGO_URI =
    'https://raw.githubusercontent.com/Doist/comms-cli/d65c447ff453eb36af585044c2f5f2f602bcdb34/icons/comms-cli.png'

export const READ_WRITE_SCOPES = [
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

export const READ_ONLY_SCOPES = [
    'user:read',
    'workspaces:read',
    'comms:channels:read',
    'comms:content:read',
    'comms:messages:read',
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
 * Todoist OAuth uses RFC 7591 Dynamic Client Registration plus PKCE. The
 * provider owns the DCR/register, authorize, and token-exchange mechanics so it
 * can include the Comms resource indicator on both OAuth requests.
 */
type DynamicClient = {
    clientId: string
    clientSecret: string
}

type OAuthHandshake = DynamicClient & {
    codeVerifier?: string
}

type OAuthHandshakeWithVerifier = DynamicClient & {
    codeVerifier: string
}

type DynamicClientResponse = {
    client_id?: string
    client_secret?: string
}

type TokenResponse = {
    access_token?: string
    refresh_token?: string
    expires_in?: number
}

async function safeReadText(response: Response): Promise<string | undefined> {
    const text = await response.text().catch(() => '')
    const trimmed = text.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

function authFailed(message: string, error: unknown): CliError {
    return new CliError('AUTH_FAILED', `${message}: ${getErrorMessage(error)}`, AUTH_HINTS)
}

function asOAuthHandshake(
    handshake: Record<string, unknown>,
    options: { requireCodeVerifier: true },
): OAuthHandshakeWithVerifier
function asOAuthHandshake(
    handshake: Record<string, unknown>,
    options?: { requireCodeVerifier?: false },
): OAuthHandshake
function asOAuthHandshake(
    handshake: Record<string, unknown>,
    options: { requireCodeVerifier?: boolean } = {},
): OAuthHandshake | OAuthHandshakeWithVerifier {
    const requireCodeVerifier = options.requireCodeVerifier ?? false
    const clientId = handshake.clientId
    const clientSecret = handshake.clientSecret
    const codeVerifier = handshake.codeVerifier
    if (
        typeof clientId !== 'string' ||
        typeof clientSecret !== 'string' ||
        (requireCodeVerifier && typeof codeVerifier !== 'string')
    ) {
        throw new CliError('AUTH_FAILED', 'Internal: OAuth handshake state was lost.', AUTH_HINTS)
    }
    return {
        clientId,
        clientSecret,
        codeVerifier: typeof codeVerifier === 'string' ? codeVerifier : undefined,
    }
}

async function registerDynamicClient(redirectUri: string): Promise<DynamicClient> {
    let response: Response
    try {
        response = await fetch(REGISTRATION_URL, {
            method: 'POST',
            signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                redirect_uris: [redirectUri],
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'client_secret_post',
                application_type: 'native',
                client_name: 'Comms CLI',
                client_uri: 'https://github.com/doist/comms-cli',
                logo_uri: LOGO_URI,
            }),
        })
    } catch (error) {
        throw authFailed('Failed to register OAuth client', error)
    }

    if (!response.ok) {
        const detail = await safeReadText(response)
        throw new CliError(
            'AUTH_FAILED',
            `Client registration failed: ${response.status} ${response.statusText}`,
            detail ? [detail, ...AUTH_HINTS] : AUTH_HINTS,
        )
    }

    let result: DynamicClientResponse
    try {
        result = (await response.json()) as DynamicClientResponse
    } catch (error) {
        throw authFailed('Invalid client registration response', error)
    }

    if (!result.client_id || !result.client_secret) {
        throw new CliError(
            'AUTH_FAILED',
            'Invalid client registration response: missing client_id or client_secret',
            AUTH_HINTS,
        )
    }

    return { clientId: result.client_id, clientSecret: result.client_secret }
}

export function createCommsAuthProvider(): AuthProvider<CommsAccount> {
    return {
        async prepare({ redirectUri }) {
            return { handshake: await registerDynamicClient(redirectUri) }
        },
        async authorize({ redirectUri, state, scopes, handshake }) {
            const { clientId } = asOAuthHandshake(handshake)
            const codeVerifier = generateVerifier({ alphabet: TODOIST_VERIFIER_ALPHABET })
            const url = new URL(AUTHORIZATION_URL)
            url.searchParams.set('client_id', clientId)
            url.searchParams.set('response_type', 'code')
            url.searchParams.set('redirect_uri', redirectUri)
            url.searchParams.set('scope', scopes.join(','))
            url.searchParams.set('state', state)
            url.searchParams.set('code_challenge', deriveChallenge(codeVerifier))
            url.searchParams.set('code_challenge_method', 'S256')
            url.searchParams.set('resource', OAUTH_RESOURCE)
            return {
                authorizeUrl: url.toString(),
                handshake: { codeVerifier },
            }
        },
        async exchangeCode({ code, redirectUri, handshake }) {
            const { clientId, clientSecret, codeVerifier } = asOAuthHandshake(handshake, {
                requireCodeVerifier: true,
            })
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
                client_secret: clientSecret,
                code_verifier: codeVerifier,
                resource: OAUTH_RESOURCE,
            })

            let response: Response
            try {
                response = await fetch(TOKEN_URL, {
                    method: 'POST',
                    signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Accept: 'application/json',
                    },
                    body: body.toString(),
                })
            } catch (error) {
                throw authFailed('Token endpoint request failed', error)
            }

            if (!response.ok) {
                const detail = await safeReadText(response)
                throw new CliError(
                    'AUTH_FAILED',
                    `Token endpoint returned HTTP ${response.status}.`,
                    detail ? [detail, ...AUTH_HINTS] : AUTH_HINTS,
                )
            }

            let payload: TokenResponse
            try {
                payload = (await response.json()) as TokenResponse
            } catch (error) {
                throw authFailed('Token endpoint returned non-JSON response', error)
            }

            if (!payload.access_token) {
                throw new CliError(
                    'AUTH_FAILED',
                    'Token endpoint response missing access_token.',
                    AUTH_HINTS,
                )
            }

            return {
                accessToken: payload.access_token,
                refreshToken: payload.refresh_token,
                expiresAt:
                    typeof payload.expires_in === 'number'
                        ? Date.now() + payload.expires_in * 1000
                        : undefined,
            }
        },
        async validateToken({ token, handshake }) {
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
    }
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

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

export const AUTHORIZATION_URL = 'https://comms.todoist.com/oauth/authorize'
export const TOKEN_URL = 'https://comms.todoist.com/oauth/access_token'
export const REGISTRATION_URL = 'https://comms.todoist.com/oauth/register'

const LOGO_URI =
    'https://raw.githubusercontent.com/Doist/comms-cli/d65c447ff453eb36af585044c2f5f2f602bcdb34/icons/comms-cli.png'

export const READ_WRITE_SCOPES = [
    'user:read',
    'user:write',
    'workspaces:read',
    'channels:read',
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
]

const AUTH_HINTS = ['Try again: tdc auth login', 'Or set COMMS_API_TOKEN environment variable']

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

type CommsHandshake = Record<string, unknown> & {
    clientId: string
    clientSecret: string
    codeVerifier?: string
    authMode?: AuthMode
    authScope?: string
}

function asHandshake(value: Record<string, unknown>): CommsHandshake {
    return value as CommsHandshake
}

function authFailed(message: string, cause?: unknown): CliError {
    const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : ''
    return new CliError('AUTH_FAILED', `${message}${detail}`, AUTH_HINTS)
}

async function registerDynamicClient(
    redirectUri: string,
): Promise<{ clientId: string; clientSecret: string }> {
    let response: Response
    try {
        response = await fetch(REGISTRATION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                client_name: 'Comms CLI',
                client_uri: 'https://github.com/doist/comms-cli',
                redirect_uris: [redirectUri],
                grant_types: ['authorization_code'],
                response_types: ['code'],
                token_endpoint_auth_method: 'client_secret_basic',
                application_type: 'native',
                logo_uri: LOGO_URI,
            }),
        })
    } catch (error) {
        if (error instanceof CliError) throw error
        throw authFailed('Failed to register OAuth client', error)
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new CliError(
            'AUTH_FAILED',
            `Client registration failed: ${response.status} ${response.statusText} - ${errorText}`,
            AUTH_HINTS,
        )
    }

    let result: { client_id?: string; client_secret?: string }
    try {
        result = (await response.json()) as { client_id?: string; client_secret?: string }
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
            const { clientId, clientSecret } = await registerDynamicClient(redirectUri)
            const handshake: CommsHandshake = { clientId, clientSecret }
            return { handshake }
        },

        async authorize({ redirectUri, state, scopes, readOnly, handshake }) {
            const hs = asHandshake(handshake)
            const codeVerifier = generateVerifier()
            const codeChallenge = deriveChallenge(codeVerifier)
            const authMode: AuthMode = readOnly ? 'read-only' : 'read-write'
            const authScope = scopes.join(' ')

            const params = new URLSearchParams({
                client_id: hs.clientId,
                response_type: 'code',
                redirect_uri: redirectUri,
                scope: authScope,
                state,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256',
            })

            const nextHandshake: CommsHandshake = {
                ...hs,
                codeVerifier,
                authMode,
                authScope,
            }
            return {
                authorizeUrl: `${AUTHORIZATION_URL}?${params.toString()}`,
                handshake: nextHandshake,
            }
        },

        async exchangeCode({ code, redirectUri, handshake }) {
            const hs = asHandshake(handshake)
            if (!hs.codeVerifier) {
                throw new CliError(
                    'AUTH_FAILED',
                    'Missing PKCE code verifier from authorize step',
                    AUTH_HINTS,
                )
            }

            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                code_verifier: hs.codeVerifier,
            })

            const credentials = btoa(`${hs.clientId}:${hs.clientSecret}`)

            let response: Response
            try {
                response = await fetch(TOKEN_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Accept: 'application/json',
                        Authorization: `Basic ${credentials}`,
                    },
                    body: body.toString(),
                })
            } catch (error) {
                if (error instanceof CliError) throw error
                throw authFailed('Failed to exchange code for token', error)
            }

            if (!response.ok) {
                const errorText = await response.text().catch(() => '')
                throw new CliError(
                    'AUTH_FAILED',
                    `Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`,
                    AUTH_HINTS,
                )
            }

            let data: {
                access_token?: string
                error?: string
                error_description?: string
            }
            try {
                data = (await response.json()) as typeof data
            } catch (error) {
                throw authFailed('Invalid token exchange response', error)
            }

            if (data.error) {
                throw new CliError(
                    'AUTH_FAILED',
                    `OAuth error: ${data.error} - ${data.error_description ?? 'Unknown error'}`,
                    AUTH_HINTS,
                )
            }

            if (!data.access_token) {
                throw new CliError(
                    'AUTH_FAILED',
                    'No access token received from OAuth server',
                    AUTH_HINTS,
                )
            }

            return { accessToken: data.access_token }
        },

        async validateToken({ token, handshake }) {
            const hs = asHandshake(handshake)
            const client = createWrappedCommsClient(token)
            const user = await client.users.getSessionUser()
            return toCommsAccount(user, { authMode: hs.authMode, authScope: hs.authScope })
        },
    }
}

/**
 * Accepts `42`, `id:42`, and case-insensitive labels — `parseRef` normalises
 * the numeric forms. Broader than cli-core's default strict-equality matcher.
 */
export function matchCommsAccount(account: CommsAccount, ref: AccountRef): boolean {
    const parsed = parseRef(ref)
    if (parsed.type === 'id') return Number(account.id) === parsed.id
    if (parsed.type === 'name') return account.label.toLowerCase() === parsed.name.toLowerCase()
    return false
}

const TOKEN_ENV_VAR = 'COMMS_API_TOKEN'

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
            if (ref === undefined) {
                const envToken = process.env[TOKEN_ENV_VAR]
                if (envToken) {
                    return { token: envToken, account: MANUAL_TOKEN_ACCOUNT }
                }
            }
            return inner.active(ref)
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

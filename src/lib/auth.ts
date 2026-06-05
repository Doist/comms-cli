import { refreshAccessToken, SecureStoreUnavailableError } from '@doist/cli-core/auth'
import type { CommsAccount } from './auth-provider.js'
import {
    createCommsAuthProvider,
    createCommsTokenStore,
    getActiveTokenSource,
    getCommsOAuthRefreshHandshake,
} from './auth-provider.js'
import { type AuthMode, getConfig, getConfigPath } from './config.js'
import { CliError } from './errors.js'
import { getDefaultUserRecord } from './user-records.js'

export { SecureStoreUnavailableError }

export const TOKEN_ENV_VAR = 'COMMS_API_TOKEN'

export const SECURE_STORE_DESCRIPTION = 'system credential manager'

export type TokenStorageLocation = 'secure-store' | 'config-file'

export type TokenStorageResult = {
    storage: TokenStorageLocation
    warning?: string
}

export type AuthMetadata = {
    authMode: AuthMode
    authResource?: string
    authScope?: string
    authUserId?: number
    authUserName?: string
    source: 'env' | 'config'
}

export type AuthProbeMetadata = {
    authMode: AuthMode
    authResource?: string
    authScope?: string
    authUserId?: number
    authUserName?: string
    source: 'env' | 'config-file' | 'secure-store'
}

export type AuthProbeResult = {
    token: string
    metadata: AuthProbeMetadata
}

export type AuthProbeOptions = {
    refresh?: boolean
}

export type ActiveAuthSnapshot = {
    token: string
    account: CommsAccount
}

const REFRESH_SKEW_MS = 60_000

export class NoTokenError extends CliError {
    constructor() {
        super(
            'NO_TOKEN',
            `No API token found. Set ${TOKEN_ENV_VAR} or run \`tdc auth login\` or \`tdc auth token <token>\`.`,
            ['Set COMMS_API_TOKEN or run: tdc auth login'],
            'info',
        )
        this.name = 'NoTokenError'
    }
}

/** Read the active token. The store wraps env-var precedence internally. */
export async function getApiToken(): Promise<string> {
    const snapshot = await getApiTokenSnapshot()
    return snapshot.token
}

export async function getApiTokenSnapshot(ref?: string): Promise<ActiveAuthSnapshot> {
    return getActiveSnapshot({ refresh: true, ref })
}

/** Token + metadata in one round-trip for `tdc config view` / `tdc doctor`. */
export async function probeApiToken(options: AuthProbeOptions = {}): Promise<AuthProbeResult> {
    const snapshot = await getActiveSnapshot({ refresh: options.refresh === true })
    const source = await getActiveTokenSource()
    return {
        token: snapshot.token,
        metadata:
            source === 'env'
                ? { authMode: 'unknown', source: 'env' }
                : { ...toAccountFields(snapshot.account), source },
    }
}

async function getActiveSnapshot({
    refresh,
    ref,
}: {
    refresh: boolean
    ref?: string
}): Promise<ActiveAuthSnapshot> {
    const store = createCommsTokenStore()
    const snapshot = await store.activeBundle(ref)
    if (!snapshot) throw new NoTokenError()

    const { account, bundle } = snapshot
    const expiresAt = bundle.accessTokenExpiresAt
    if (expiresAt !== undefined) {
        const now = Date.now()
        if (refresh && bundle.refreshToken && expiresAt - now < REFRESH_SKEW_MS) {
            if (!account.oauthClientId) {
                if (expiresAt > now) return { token: bundle.accessToken, account }
                throw new CliError(
                    'NO_TOKEN',
                    'Stored OAuth token cannot be refreshed because its client metadata is missing.',
                    ['Run: tdc auth login'],
                )
            }
            const refreshed = await refreshAccessToken({
                store,
                provider: createCommsAuthProvider(),
                skewMs: REFRESH_SKEW_MS,
                lockPath: `${getConfigPath()}.refresh.lock`,
                handshake: getCommsOAuthRefreshHandshake(account),
            })
            return { token: refreshed.bundle.accessToken, account: refreshed.account }
        }
        if (refresh && expiresAt <= now) {
            throw new CliError(
                'NO_TOKEN',
                'Stored OAuth token has expired and cannot be refreshed.',
                ['Run: tdc auth login'],
            )
        }
    }
    return { token: bundle.accessToken, account }
}

/** Auth metadata for `tdc auth status` and `ensureWriteAllowed`. */
export async function getAuthMetadata(): Promise<AuthMetadata> {
    if (process.env[TOKEN_ENV_VAR]) return { authMode: 'unknown', source: 'env' }
    const config = await getConfig()
    const record = getDefaultUserRecord(config)
    if (record) return { ...toAccountFields(record.account), source: 'config' }
    return { authMode: 'unknown', source: 'config' }
}

function toAccountFields(account: CommsAccount): {
    authMode: AuthMode
    authResource?: string
    authScope?: string
    authUserId?: number
    authUserName?: string
} {
    return {
        authMode: account.authMode,
        ...(account.authResource ? { authResource: account.authResource } : {}),
        authScope: account.authScope || undefined,
        authUserId: account.id ? toAuthUserId(account.id) : undefined,
        authUserName: account.label || undefined,
    }
}

function toAuthUserId(id: string): number | undefined {
    const num = Number(id)
    return Number.isFinite(num) && num > 0 ? num : undefined
}

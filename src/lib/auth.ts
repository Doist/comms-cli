import { SecureStoreUnavailableError } from '@doist/cli-core/auth'
import type { CommsAccount } from './auth-provider.js'
import { createCommsTokenStore, getActiveTokenSource } from './auth-provider.js'
import { type AuthMode, getConfig } from './config.js'
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
    authScope?: string
    authUserId?: number
    authUserName?: string
    source: 'env' | 'config'
}

export type AuthProbeMetadata = {
    authMode: AuthMode
    authScope?: string
    authUserId?: number
    authUserName?: string
    source: 'env' | 'config-file' | 'secure-store'
}

export type AuthProbeResult = {
    token: string
    metadata: AuthProbeMetadata
}

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
    const snapshot = await createCommsTokenStore().active()
    if (!snapshot) throw new NoTokenError()
    return snapshot.token
}

/** Token + metadata in one round-trip for `tdc config view` / `tdc doctor`. */
export async function probeApiToken(): Promise<AuthProbeResult> {
    const snapshot = await createCommsTokenStore().active()
    if (!snapshot) throw new NoTokenError()
    const source = await getActiveTokenSource()
    return {
        token: snapshot.token,
        metadata:
            source === 'env'
                ? { authMode: 'unknown', source: 'env' }
                : { ...toAccountFields(snapshot.account), source },
    }
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
    authScope?: string
    authUserId?: number
    authUserName?: string
} {
    return {
        authMode: account.authMode,
        authScope: account.authScope || undefined,
        authUserId: account.id ? toAuthUserId(account.id) : undefined,
        authUserName: account.label || undefined,
    }
}

function toAuthUserId(id: string): number | undefined {
    const num = Number(id)
    return Number.isFinite(num) && num > 0 ? num : undefined
}

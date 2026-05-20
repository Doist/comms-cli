import {
    getConfigPath as getConfigPathCore,
    readConfig as readConfigCore,
    readConfigStrict as readConfigStrictCore,
    updateConfig as updateConfigCore,
    writeConfig as writeConfigCore,
} from '@doist/cli-core'
import { CliError } from './errors.js'

const APP_NAME = 'comms-cli'

/**
 * Resolve the canonical config path lazily. Computing on each call (instead of
 * caching at module load) keeps the path responsive to vitest's `vi.doMock`
 * for `node:os` — which only reliably reaches cli-core's compiled `homedir()`
 * call after the mock has been set up by the test, not at import time.
 */
export function getConfigPath(): string {
    return getConfigPathCore(APP_NAME)
}

export type AuthMode = 'read-only' | 'read-write' | 'unknown'
export type UpdateChannel = 'stable' | 'pre-release'

const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set([
    'currentWorkspace',
    // cli-core's update command writes the channel under `update_channel`;
    // the in-memory `Config` exposes it as `updateChannel`.
    'update_channel',
    'userSettings',
    'users',
    'defaultUserId',
])

const KNOWN_STORED_USER_KEYS: ReadonlySet<string> = new Set([
    'id',
    'name',
    'authMode',
    'authScope',
    'token',
])

const KNOWN_USER_SETTINGS_KEYS: ReadonlySet<string> = new Set(['unarchiveNewThreads'])

const AUTH_MODES: ReadonlySet<AuthMode> = new Set(['read-only', 'read-write', 'unknown'])
export const UPDATE_CHANNELS: ReadonlySet<UpdateChannel> = new Set(['stable', 'pre-release'])

export interface UserSettings {
    unarchiveNewThreads?: boolean
}

/**
 * One row of the `users[]` array. `id` is the stringified numeric Comms user
 * id. `token` is a plaintext fallback persisted only when the keyring is
 * unavailable at write time.
 */
export type StoredUser = {
    id: string
    name: string
    authMode?: AuthMode
    authScope?: string
    token?: string
}

export interface Config {
    users?: StoredUser[]
    defaultUserId?: string
    currentWorkspace?: number
    updateChannel?: UpdateChannel
    userSettings?: UserSettings
}

/**
 * Read-seam translation: cli-core's update command writes the channel under
 * `update_channel` (snake_case); we expose it as `updateChannel` (camelCase)
 * to keep the in-memory shape idiomatic TS. Non-object inputs are returned
 * untouched so the downstream cast doesn't blow up.
 */
function fromDiskShape(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {}
    }
    const record = raw as Record<string, unknown>
    if (!('update_channel' in record)) return record
    const { update_channel, ...rest } = record
    return update_channel === undefined ? rest : { ...rest, updateChannel: update_channel }
}

/** Write-seam translation: camelCase `updateChannel` → snake_case `update_channel` on disk. */
function toDiskShape(config: Partial<Config>): Record<string, unknown> {
    const { updateChannel, ...rest } = config
    if (updateChannel === undefined) return rest
    return { ...rest, update_channel: updateChannel }
}

/**
 * Thin wrapper around cli-core's lenient `readConfig`. Returns `{}` when the
 * file is missing, unreadable, or invalid — runtime code paths treat "no
 * config" and "empty config" the same. Use `readConfigStrict` for inspection
 * commands that need to distinguish failure modes.
 */
export async function getConfig(): Promise<Config> {
    const raw = await readConfigCore<Record<string, unknown>>(getConfigPath())
    return fromDiskShape(raw) as Config
}

export type StrictReadResult = { state: 'missing' } | { state: 'present'; config: Config }

/**
 * Read and parse the config file strictly — for inspection commands that need
 * to distinguish "missing" from "present but broken". `getConfig` deliberately
 * swallows errors for runtime code paths; this one surfaces them.
 */
export async function readConfigStrict(): Promise<StrictReadResult> {
    const path = getConfigPath()
    const result = await readConfigStrictCore(path)
    switch (result.state) {
        case 'missing':
            return { state: 'missing' }
        case 'present':
            return {
                state: 'present',
                config: fromDiskShape(result.config) as Config,
            }
        case 'read-failed':
            throw new CliError(
                'CONFIG_READ_FAILED',
                `Could not read config file ${path}: ${result.error.message}`,
                ['Check file permissions, or run `cm doctor` to diagnose'],
            )
        case 'invalid-json':
            throw new CliError(
                'CONFIG_INVALID_JSON',
                `Config file at ${path} is not valid JSON: ${result.error.message}`,
                [
                    'Fix the JSON by hand, or delete the file and re-authenticate with `cm auth login`',
                ],
            )
        case 'invalid-shape':
            throw new CliError(
                'CONFIG_INVALID_SHAPE',
                `Config file at ${path} must contain a JSON object (got ${result.actual})`,
                [
                    'Fix the JSON by hand, or delete the file and re-authenticate with `cm auth login`',
                ],
            )
    }
}

/** Thin wrapper around cli-core's `writeConfig`. */
export async function setConfig(config: Config): Promise<void> {
    await writeConfigCore(getConfigPath(), toDiskShape(config))
}

/**
 * Atomic partial-write wrapper around cli-core's `updateConfig`. Preserves
 * cli-core's read-merge-write atomicity so two concurrent `cm` processes
 * can't lose each other's updates.
 */
export async function updateConfig(updates: Partial<Config>): Promise<void> {
    await updateConfigCore<Record<string, unknown>>(getConfigPath(), toDiskShape(updates))
}

export function validateConfigForDoctor(config: Record<string, unknown>): string[] {
    const issues: string[] = []

    for (const key of Object.keys(config)) {
        if (!KNOWN_CONFIG_KEYS.has(key)) {
            issues.push(`contains unrecognized key "${key}"`)
        }
    }

    if (
        config.currentWorkspace !== undefined &&
        (!Number.isInteger(config.currentWorkspace) || Number(config.currentWorkspace) <= 0)
    ) {
        issues.push('currentWorkspace must be a positive integer')
    }

    if (
        config.update_channel !== undefined &&
        (typeof config.update_channel !== 'string' ||
            !UPDATE_CHANNELS.has(config.update_channel as UpdateChannel))
    ) {
        issues.push('update_channel must be one of: stable, pre-release')
    }

    if (config.defaultUserId !== undefined && typeof config.defaultUserId !== 'string') {
        issues.push('defaultUserId must be a string')
    }

    if (config.users !== undefined) {
        if (!Array.isArray(config.users)) {
            issues.push('users must be an array')
        } else {
            for (let i = 0; i < config.users.length; i++) {
                const user = config.users[i]
                if (user === null || typeof user !== 'object' || Array.isArray(user)) {
                    issues.push(`users[${i}] must be an object`)
                    continue
                }
                const userRecord = user as Record<string, unknown>
                for (const key of Object.keys(userRecord)) {
                    if (!KNOWN_STORED_USER_KEYS.has(key)) {
                        issues.push(`users[${i}] contains unrecognized key "${key}"`)
                    }
                }
                if (typeof userRecord.id !== 'string') {
                    issues.push(`users[${i}].id must be a string`)
                }
                if (typeof userRecord.name !== 'string') {
                    issues.push(`users[${i}].name must be a string`)
                }
                if (
                    userRecord.authMode !== undefined &&
                    (typeof userRecord.authMode !== 'string' ||
                        !AUTH_MODES.has(userRecord.authMode as AuthMode))
                ) {
                    issues.push(
                        `users[${i}].authMode must be one of: read-only, read-write, unknown`,
                    )
                }
                if (
                    userRecord.authScope !== undefined &&
                    typeof userRecord.authScope !== 'string'
                ) {
                    issues.push(`users[${i}].authScope must be a string`)
                }
                if (userRecord.token !== undefined && typeof userRecord.token !== 'string') {
                    issues.push(`users[${i}].token must be a string`)
                }
            }
        }
    }

    if (config.userSettings !== undefined) {
        const userSettings = config.userSettings
        if (
            userSettings === null ||
            typeof userSettings !== 'object' ||
            Array.isArray(userSettings)
        ) {
            issues.push('userSettings must be an object')
        } else {
            const settingsRecord = userSettings as Record<string, unknown>
            for (const key of Object.keys(settingsRecord)) {
                if (!KNOWN_USER_SETTINGS_KEYS.has(key)) {
                    issues.push(`userSettings contains unrecognized key "${key}"`)
                }
            }
            if (
                settingsRecord.unarchiveNewThreads !== undefined &&
                typeof settingsRecord.unarchiveNewThreads !== 'boolean'
            ) {
                issues.push('userSettings.unarchiveNewThreads must be a boolean')
            }
        }
    }

    return issues
}

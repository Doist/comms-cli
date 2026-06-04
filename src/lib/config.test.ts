import { describe, expect, it, vi } from 'vitest'

vi.mock('@doist/cli-core', async () => {
    const actual = await vi.importActual<typeof import('@doist/cli-core')>('@doist/cli-core')
    return {
        ...actual,
        getConfigPath: vi.fn((appName: string) => `/tmp/cli-core-test/${appName}/config.json`),
        readConfig: vi.fn(),
        readConfigStrict: vi.fn(),
        writeConfig: vi.fn(),
        updateConfig: vi.fn(),
    }
})

import {
    getConfigPath as getConfigPathCore,
    readConfig as readConfigCore,
    readConfigStrict as readConfigStrictCore,
    updateConfig as updateConfigCore,
    writeConfig as writeConfigCore,
} from '@doist/cli-core'
import {
    getConfig,
    getConfigPath,
    readConfigStrict,
    setConfig,
    updateConfig,
    validateConfigForDoctor,
} from './config.js'

const mockGetConfigPathCore = vi.mocked(getConfigPathCore)
const mockReadConfigCore = vi.mocked(readConfigCore)
const mockReadConfigStrictCore = vi.mocked(readConfigStrictCore)
const mockUpdateConfigCore = vi.mocked(updateConfigCore)
const mockWriteConfigCore = vi.mocked(writeConfigCore)

describe('validateConfigForDoctor', () => {
    it('accepts an empty config', () => {
        expect(validateConfigForDoctor({})).toEqual([])
    })

    it('accepts a valid userSettings.unarchiveNewThreads', () => {
        expect(validateConfigForDoctor({ userSettings: { unarchiveNewThreads: true } })).toEqual([])
        expect(validateConfigForDoctor({ userSettings: { unarchiveNewThreads: false } })).toEqual(
            [],
        )
        expect(validateConfigForDoctor({ userSettings: {} })).toEqual([])
    })

    it('rejects non-boolean unarchiveNewThreads', () => {
        const issues = validateConfigForDoctor({
            userSettings: { unarchiveNewThreads: 'yes' },
        })
        expect(issues).toContain('userSettings.unarchiveNewThreads must be a boolean')
    })

    it('rejects unknown nested keys under userSettings', () => {
        const issues = validateConfigForDoctor({
            userSettings: { somethingElse: 1 },
        })
        expect(issues).toContain('userSettings contains unrecognized key "somethingElse"')
    })

    it('rejects userSettings that is not an object', () => {
        expect(validateConfigForDoctor({ userSettings: true })).toContain(
            'userSettings must be an object',
        )
        expect(validateConfigForDoctor({ userSettings: [] })).toContain(
            'userSettings must be an object',
        )
        expect(validateConfigForDoctor({ userSettings: null })).toContain(
            'userSettings must be an object',
        )
    })

    it('accepts update_channel with valid values', () => {
        expect(validateConfigForDoctor({ update_channel: 'pre-release' })).toEqual([])
        expect(validateConfigForDoctor({ update_channel: 'stable' })).toEqual([])
    })

    it('rejects invalid update_channel values', () => {
        expect(validateConfigForDoctor({ update_channel: 'beta' })).toContain(
            'update_channel must be one of: stable, pre-release',
        )
    })

    it('accepts a well-formed schema (defaultUserId, users[])', () => {
        const issues = validateConfigForDoctor({
            defaultUserId: '42',
            oauthClients: [
                {
                    clientId: 'tdd_123',
                    authBaseUrl: 'https://todoist.com',
                    authResource: 'https://comms.todoist.com',
                    redirectUri: 'http://localhost:8766/callback',
                },
            ],
            users: [
                {
                    id: '42',
                    name: 'Ada',
                    authMode: 'read-write',
                    authScope: 'user:read',
                    fallbackRefreshToken: 'rt_fallback',
                    accessTokenExpiresAt: 1770000000000,
                    refreshTokenExpiresAt: 1780000000000,
                    hasRefreshToken: true,
                    oauthClientId: 'tdd_123',
                    authBaseUrl: 'https://todoist.com',
                    authResource: 'https://comms.todoist.com',
                },
                { id: '99', name: 'Bob' },
            ],
        })
        expect(issues).toEqual([])
    })

    it('rejects malformed top-level fields', () => {
        expect(validateConfigForDoctor({ defaultUserId: 42 })).toContain(
            'defaultUserId must be a string',
        )
        expect(validateConfigForDoctor({ users: { id: '42' } })).toContain('users must be an array')
        expect(validateConfigForDoctor({ oauthClients: { clientId: 'tdd_123' } })).toContain(
            'oauthClients must be an array',
        )
    })

    it('rejects malformed StoredUser entries (shape, types, unknown keys, invalid authMode)', () => {
        const issues = validateConfigForDoctor({
            users: [
                { id: 42, name: 'Ada' },
                { id: '99', name: 5 },
                'not-an-object',
                { id: '7', name: 'Carl', somethingElse: true },
                { id: '8', name: 'Dora', authMode: 'bogus' },
                { id: '9', name: 'Eve', authScope: 1, token: false },
                {
                    id: '10',
                    name: 'Finn',
                    fallbackRefreshToken: 1,
                    accessTokenExpiresAt: 'soon',
                    refreshTokenExpiresAt: Number.POSITIVE_INFINITY,
                    hasRefreshToken: 'yes',
                    oauthClientId: 123,
                    authBaseUrl: false,
                    authResource: 7,
                },
            ],
        })
        expect(issues).toEqual(
            expect.arrayContaining([
                'users[0].id must be a string',
                'users[1].name must be a string',
                'users[2] must be an object',
                'users[3] contains unrecognized key "somethingElse"',
                'users[4].authMode must be one of: read-only, read-write, unknown',
                'users[5].authScope must be a string',
                'users[5].token must be a string',
                'users[6].fallbackRefreshToken must be a string',
                'users[6].accessTokenExpiresAt must be a finite number',
                'users[6].refreshTokenExpiresAt must be a finite number',
                'users[6].hasRefreshToken must be a boolean',
                'users[6].oauthClientId must be a string',
                'users[6].authBaseUrl must be a string',
                'users[6].authResource must be a string',
            ]),
        )
    })
})

describe('persistence-seam translation', () => {
    it('getConfig translates on-disk update_channel to in-memory updateChannel', async () => {
        mockReadConfigCore.mockResolvedValueOnce({ update_channel: 'pre-release' })
        await expect(getConfig()).resolves.toEqual({ updateChannel: 'pre-release' })
    })

    it('getConfig guards against a manually-edited config that is not an object', async () => {
        mockReadConfigCore.mockResolvedValueOnce(null as never)
        await expect(getConfig()).resolves.toEqual({})

        mockReadConfigCore.mockResolvedValueOnce('not an object' as never)
        await expect(getConfig()).resolves.toEqual({})

        mockReadConfigCore.mockResolvedValueOnce(['array', 'top-level'] as never)
        await expect(getConfig()).resolves.toEqual({})
    })

    it('readConfigStrict translates update_channel on the present branch', async () => {
        mockReadConfigStrictCore.mockResolvedValueOnce({
            state: 'present',
            config: { update_channel: 'pre-release' },
        })
        await expect(readConfigStrict()).resolves.toEqual({
            state: 'present',
            config: { updateChannel: 'pre-release' },
        })
    })
})

describe('readConfigStrict wrapper', () => {
    it('passes the missing state through unchanged', async () => {
        mockReadConfigStrictCore.mockResolvedValueOnce({ state: 'missing' })
        await expect(readConfigStrict()).resolves.toEqual({ state: 'missing' })
    })

    it('passes the present state through with a Config-shaped cast', async () => {
        mockReadConfigStrictCore.mockResolvedValueOnce({
            state: 'present',
            config: { currentWorkspace: 42, defaultUserId: '1' },
        })
        await expect(readConfigStrict()).resolves.toEqual({
            state: 'present',
            config: { currentWorkspace: 42, defaultUserId: '1' },
        })
    })

    it('translates read-failed to CONFIG_READ_FAILED with comms hint copy', async () => {
        mockReadConfigStrictCore.mockResolvedValueOnce({
            state: 'read-failed',
            error: new Error('EACCES: permission denied'),
        })
        await expect(readConfigStrict()).rejects.toMatchObject({
            code: 'CONFIG_READ_FAILED',
            message: expect.stringContaining('EACCES: permission denied'),
            hints: ['Check file permissions, or run `tdc doctor` to diagnose'],
        })
    })

    it('translates invalid-json to CONFIG_INVALID_JSON with re-auth hint', async () => {
        mockReadConfigStrictCore.mockResolvedValueOnce({
            state: 'invalid-json',
            error: new SyntaxError('Unexpected token } in JSON at position 12'),
        })
        await expect(readConfigStrict()).rejects.toMatchObject({
            code: 'CONFIG_INVALID_JSON',
            message: expect.stringContaining('Unexpected token'),
            hints: [
                'Fix the JSON by hand, or delete the file and re-authenticate with `tdc auth login`',
            ],
        })
    })

    it('translates invalid-shape to CONFIG_INVALID_SHAPE and surfaces the actual type', async () => {
        mockReadConfigStrictCore.mockResolvedValueOnce({
            state: 'invalid-shape',
            actual: 'array',
        })
        await expect(readConfigStrict()).rejects.toMatchObject({
            code: 'CONFIG_INVALID_SHAPE',
            message: expect.stringContaining('got array'),
            hints: [
                'Fix the JSON by hand, or delete the file and re-authenticate with `tdc auth login`',
            ],
        })
    })
})

// Smoke tests proving the thin wrappers forward to cli-core with the
// 'comms-cli' app name. A wrong app name would silently redirect every
// config read/write — these tests are the tripwire.

describe('thin config wrappers', () => {
    it('getConfigPath resolves under the comms-cli app name', () => {
        expect(getConfigPath()).toBe('/tmp/cli-core-test/comms-cli/config.json')
        expect(mockGetConfigPathCore).toHaveBeenCalledWith('comms-cli')
    })

    it('getConfig forwards the resolved path to cli-core readConfig', async () => {
        mockReadConfigCore.mockResolvedValueOnce({ currentWorkspace: 99 })
        await expect(getConfig()).resolves.toEqual({ currentWorkspace: 99 })
        expect(mockReadConfigCore).toHaveBeenCalledWith('/tmp/cli-core-test/comms-cli/config.json')
    })

    it('setConfig forwards the resolved path and config to cli-core writeConfig', async () => {
        mockWriteConfigCore.mockResolvedValueOnce(undefined)
        await setConfig({ currentWorkspace: 7 })
        expect(mockWriteConfigCore).toHaveBeenCalledWith(
            '/tmp/cli-core-test/comms-cli/config.json',
            { currentWorkspace: 7 },
        )
    })

    it('setConfig translates updateChannel to update_channel on disk', async () => {
        mockWriteConfigCore.mockResolvedValueOnce(undefined)
        await setConfig({ updateChannel: 'pre-release', currentWorkspace: 3 })
        expect(mockWriteConfigCore).toHaveBeenCalledWith(
            '/tmp/cli-core-test/comms-cli/config.json',
            {
                currentWorkspace: 3,
                update_channel: 'pre-release',
            },
        )
    })

    it('updateConfig delegates to cli-core (atomic) with snake_case translation', async () => {
        mockUpdateConfigCore.mockResolvedValueOnce(undefined)
        await updateConfig({ updateChannel: 'stable' })
        expect(mockUpdateConfigCore).toHaveBeenCalledWith(
            '/tmp/cli-core-test/comms-cli/config.json',
            { update_channel: 'stable' },
        )
    })

    it('updateConfig forwards non-channel partials unchanged', async () => {
        mockUpdateConfigCore.mockResolvedValueOnce(undefined)
        await updateConfig({ currentWorkspace: 12 })
        expect(mockUpdateConfigCore).toHaveBeenCalledWith(
            '/tmp/cli-core-test/comms-cli/config.json',
            { currentWorkspace: 12 },
        )
    })
})

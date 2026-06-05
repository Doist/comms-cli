import type { TokenStore } from '@doist/cli-core/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.js'

const mocks = vi.hoisted(() => ({
    activeMock: vi.fn(),
    activeBundleMock: vi.fn(),
    setBundleMock: vi.fn(),
    getConfigMock: vi.fn(),
    refreshAccessTokenMock: vi.fn(),
}))

vi.mock('@doist/cli-core/auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@doist/cli-core/auth')>()
    return {
        ...actual,
        refreshAccessToken: mocks.refreshAccessTokenMock,
    }
})

vi.mock('./auth-provider.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./auth-provider.js')>()
    return {
        ...actual,
        createCommsTokenStore: () =>
            ({
                active: mocks.activeMock,
                activeBundle: mocks.activeBundleMock,
                setBundle: mocks.setBundleMock,
            }) as unknown as TokenStore<never>,
    }
})

vi.mock('./config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./config.js')>()
    return {
        ...actual,
        getConfig: mocks.getConfigMock,
        getConfigPath: () => '/home/user/.config/comms-cli/config.json',
    }
})

import { getApiToken, getAuthMetadata, NoTokenError, probeApiToken, TOKEN_ENV_VAR } from './auth.js'

const STORED_ACCOUNT = {
    id: '42',
    label: 'Ada',
    authMode: 'read-write' as const,
    authScope: 'user:read',
}

const ADA_USER = {
    id: '42',
    name: 'Ada',
    authMode: 'read-write' as const,
    authScope: 'user:read',
}

const BOB_USER = {
    id: '99',
    name: 'Bob',
    authMode: 'read-only' as const,
    authScope: 'user:read',
}

describe('auth shims over the cli-core keyring store', () => {
    beforeEach(() => {
        mocks.activeMock.mockReset()
        mocks.activeBundleMock.mockReset()
        mocks.setBundleMock.mockReset()
        mocks.refreshAccessTokenMock.mockReset()
        mocks.getConfigMock.mockReset().mockResolvedValue({} satisfies Config)
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    // `COMMS_API_TOKEN` precedence for `getApiToken` / `probeApiToken` lives
    // inside the wrapped store (`createCommsTokenStore` in `auth-provider.ts`);
    // it's exercised end-to-end there. The shims here just delegate.

    it('getApiToken throws NoTokenError when no stored snapshot is returned', async () => {
        mocks.activeBundleMock.mockResolvedValue(null)

        await expect(getApiToken()).rejects.toBeInstanceOf(NoTokenError)
    })

    it('probeApiToken reports source=secure-store when the active record has no fallbackToken', async () => {
        mocks.activeBundleMock.mockResolvedValue({
            account: STORED_ACCOUNT,
            bundle: { accessToken: 'tk_keyring' },
        })
        mocks.getConfigMock.mockResolvedValue({ users: [ADA_USER] } satisfies Config)

        const { metadata } = await probeApiToken()

        expect(metadata).toEqual({
            authMode: 'read-write',
            authScope: 'user:read',
            authUserId: 42,
            authUserName: 'Ada',
            source: 'secure-store',
        })
    })

    it('probeApiToken reports source=config-file when the active record carries a plaintext token', async () => {
        mocks.activeBundleMock.mockResolvedValue({
            account: STORED_ACCOUNT,
            bundle: { accessToken: 'tk_fallback' },
        })
        mocks.getConfigMock.mockResolvedValue({
            users: [{ ...ADA_USER, token: 'tk_fallback' }],
        } satisfies Config)

        const { metadata } = await probeApiToken()

        expect(metadata.source).toBe('config-file')
    })

    it('probeApiToken does not refresh expiring OAuth bundles', async () => {
        const account = {
            ...STORED_ACCOUNT,
            oauthClientId: 'tdd_123',
            authBaseUrl: 'https://todoist.com',
            authResource: 'https://comms.todoist.com',
        }
        mocks.activeBundleMock.mockResolvedValue({
            account,
            bundle: {
                accessToken: 'tdc_old',
                refreshToken: 'rt_old',
                accessTokenExpiresAt: Date.now() - 1000,
            },
        })

        await expect(probeApiToken()).resolves.toMatchObject({ token: 'tdc_old' })

        expect(mocks.refreshAccessTokenMock).not.toHaveBeenCalled()
    })

    it('getApiToken refreshes expiring OAuth bundles and returns the rotated access token', async () => {
        const account = {
            ...STORED_ACCOUNT,
            oauthClientId: 'tdd_123',
            authBaseUrl: 'https://todoist.com',
            authResource: 'https://comms.todoist.com',
        }
        mocks.activeBundleMock.mockResolvedValue({
            account,
            bundle: {
                accessToken: 'tdc_old',
                refreshToken: 'rt_old',
                accessTokenExpiresAt: Date.now() - 1000,
            },
        })
        mocks.refreshAccessTokenMock.mockResolvedValue({
            account,
            bundle: { accessToken: 'tdc_new', refreshToken: 'rt_new' },
            rotated: true,
        })

        await expect(getApiToken()).resolves.toBe('tdc_new')

        expect(mocks.refreshAccessTokenMock).toHaveBeenCalledWith(
            expect.objectContaining({
                skewMs: 60_000,
                lockPath: '/home/user/.config/comms-cli/config.json.refresh.lock',
                handshake: expect.objectContaining({
                    // cli-core's createDcrProvider refresh reads `clientId`.
                    clientId: 'tdd_123',
                    accountId: '42',
                    accountLabel: 'Ada',
                    authScope: 'user:read',
                    authBaseUrl: 'https://todoist.com',
                    resource: 'https://comms.todoist.com',
                }),
            }),
        )
    })

    it('getApiToken rejects partial OAuth client metadata instead of defaulting refresh target', async () => {
        mocks.activeBundleMock.mockResolvedValue({
            account: {
                ...STORED_ACCOUNT,
                oauthClientId: 'tdd_123',
            },
            bundle: {
                accessToken: 'tdc_old',
                refreshToken: 'rt_old',
                accessTokenExpiresAt: Date.now() - 1000,
            },
        })

        await expect(getApiToken()).rejects.toMatchObject({
            code: 'NO_TOKEN',
            message:
                'Stored OAuth token cannot be refreshed because its client metadata is missing.',
        })

        expect(mocks.refreshAccessTokenMock).not.toHaveBeenCalled()
    })

    it('getApiToken uses a legacy OAuth token until it actually expires', async () => {
        mocks.activeBundleMock.mockResolvedValue({
            account: STORED_ACCOUNT,
            bundle: {
                accessToken: 'tdc_legacy',
                refreshToken: 'rt_old',
                accessTokenExpiresAt: Date.now() + 30_000,
            },
        })

        await expect(getApiToken()).resolves.toBe('tdc_legacy')

        expect(mocks.refreshAccessTokenMock).not.toHaveBeenCalled()
    })

    it('getAuthMetadata short-circuits to source=env when COMMS_API_TOKEN is set', async () => {
        vi.stubEnv(TOKEN_ENV_VAR, 'env_token_value')

        await expect(getAuthMetadata()).resolves.toEqual({ authMode: 'unknown', source: 'env' })

        expect(mocks.getConfigMock).not.toHaveBeenCalled()
    })

    it('getAuthMetadata returns config-sourced identity for the single-user case (no defaultUserId)', async () => {
        mocks.getConfigMock.mockResolvedValue({ users: [ADA_USER] } satisfies Config)

        await expect(getAuthMetadata()).resolves.toEqual({
            authMode: 'read-write',
            authScope: 'user:read',
            authUserId: 42,
            authUserName: 'Ada',
            source: 'config',
        })
    })

    it('getAuthMetadata picks the record matching defaultUserId, falling back to the first when the pinned id is missing', async () => {
        mocks.getConfigMock.mockResolvedValueOnce({
            users: [ADA_USER, BOB_USER],
            defaultUserId: '99',
        } satisfies Config)
        await expect(getAuthMetadata()).resolves.toMatchObject({
            authUserId: 99,
            authUserName: 'Bob',
        })

        mocks.getConfigMock.mockResolvedValueOnce({
            users: [ADA_USER, BOB_USER],
            defaultUserId: 'gone',
        } satisfies Config)
        await expect(getAuthMetadata()).resolves.toMatchObject({
            authUserId: 42,
            authUserName: 'Ada',
        })
    })

    it('getAuthMetadata reports source=config with unknown mode when no users are stored', async () => {
        mocks.getConfigMock.mockResolvedValue({} satisfies Config)

        await expect(getAuthMetadata()).resolves.toEqual({ authMode: 'unknown', source: 'config' })
    })
})

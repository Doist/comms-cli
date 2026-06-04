import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({ createWrappedCommsClient: vi.fn() }))

const keyringMocks = vi.hoisted(() => ({
    createKeyringTokenStore: vi.fn(),
    inner: {
        active: vi.fn(),
        activeBundle: vi.fn(),
        activeAccount: vi.fn(),
        set: vi.fn(),
        setBundle: vi.fn(),
        clear: vi.fn(),
        list: vi.fn(),
        setDefault: vi.fn(),
        getLastStorageResult: vi.fn(),
        getLastClearResult: vi.fn(),
    },
}))

vi.mock('@doist/cli-core/auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@doist/cli-core/auth')>()
    keyringMocks.createKeyringTokenStore.mockImplementation(() => keyringMocks.inner)
    return {
        ...actual,
        createKeyringTokenStore: keyringMocks.createKeyringTokenStore,
    }
})

const configMocks = vi.hoisted(() => ({
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
}))

vi.mock('./config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./config.js')>()
    return {
        ...actual,
        getConfigPath: () => '/home/user/.config/comms-cli/config.json',
        getConfig: configMocks.getConfig,
        updateConfig: configMocks.updateConfig,
    }
})

import { createWrappedCommsClient } from './api.js'
import {
    createCommsAuthProvider,
    FULL_ACCESS_SCOPES,
    matchCommsAccount,
    READ_WRITE_SCOPES,
} from './auth-provider.js'

const mockCreateClient = vi.mocked(createWrappedCommsClient)
const TOKEN_ENV_VAR = 'COMMS_API_TOKEN'

const STORED_ACCOUNT = {
    id: '42',
    label: 'Ada',
    authMode: 'read-write' as const,
    authScope: 'user:read',
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    })
}

function formBody(call: unknown[]): URLSearchParams {
    const init = call[1] as RequestInit
    return new URLSearchParams(String(init.body))
}

async function loadCreateCommsTokenStore(): Promise<
    typeof import('./auth-provider.js').createCommsTokenStore
> {
    vi.resetModules()
    const mod = await import('./auth-provider.js')
    return mod.createCommsTokenStore
}

describe('createCommsAuthProvider', () => {
    beforeEach(() => {
        configMocks.getConfig.mockReset().mockResolvedValue({})
        configMocks.updateConfig.mockReset().mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.clearAllMocks()
        vi.unstubAllEnvs()
    })

    it('registers a public Todoist DCR client for the local callback URI', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValue(
                jsonResponse(
                    { client_id: 'tdd_123', token_endpoint_auth_method: 'none' },
                    { status: 201 },
                ),
            )

        const result = await createCommsAuthProvider(fetchImpl).prepare!({
            redirectUri: 'http://localhost:8766/callback',
            flags: {},
        })

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][0]).toBe('https://todoist.com/oauth/register')
        expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toEqual({
            client_name: 'Comms CLI',
            client_uri: 'https://github.com/doist/comms-cli',
            logo_uri:
                'https://raw.githubusercontent.com/Doist/comms-cli/d65c447ff453eb36af585044c2f5f2f602bcdb34/icons/comms-cli.png',
            redirect_uris: ['http://localhost:8766/callback'],
            scope: FULL_ACCESS_SCOPES.join(' '),
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        })
        expect(result.handshake).toMatchObject({
            oauthClientId: 'tdd_123',
            authBaseUrl: 'https://todoist.com',
            resource: 'https://comms.todoist.com',
        })
        expect(configMocks.updateConfig).toHaveBeenCalledWith({
            oauthClients: [
                {
                    clientId: 'tdd_123',
                    authBaseUrl: 'https://todoist.com',
                    authResource: 'https://comms.todoist.com',
                    redirectUri: 'http://localhost:8766/callback',
                },
            ],
        })
    })

    it('reuses a cached DCR client for the same auth server, resource, and redirect URI', async () => {
        configMocks.getConfig.mockResolvedValue({
            oauthClients: [
                {
                    clientId: 'tdd_cached',
                    authBaseUrl: 'https://todoist.com',
                    authResource: 'https://comms.todoist.com',
                    redirectUri: 'http://localhost:8766/callback',
                },
            ],
        })
        const fetchImpl = vi.fn()

        const result = await createCommsAuthProvider(fetchImpl).prepare!({
            redirectUri: 'http://localhost:8766/callback',
            flags: {},
        })

        expect(fetchImpl).not.toHaveBeenCalled()
        expect(configMocks.updateConfig).not.toHaveBeenCalled()
        expect(result.handshake).toMatchObject({
            oauthClientId: 'tdd_cached',
            authBaseUrl: 'https://todoist.com',
            resource: 'https://comms.todoist.com',
        })
    })

    it('uses staging Todoist OAuth endpoints when COMMS_BASE_URL targets staging Comms', async () => {
        vi.stubEnv('COMMS_BASE_URL', 'https://comms.staging.todoist.com/api/v1')
        const fetchImpl = vi
            .fn()
            .mockResolvedValue(
                jsonResponse(
                    { client_id: 'tdd_staging', token_endpoint_auth_method: 'none' },
                    { status: 201 },
                ),
            )

        const prepared = await createCommsAuthProvider(fetchImpl).prepare!({
            redirectUri: 'http://localhost:8766/callback',
            flags: {},
        })
        const authorized = await createCommsAuthProvider(fetchImpl).authorize({
            redirectUri: 'http://localhost:8766/callback',
            state: 'state_123',
            scopes: ['user:read', 'comms:content:read'],
            readOnly: true,
            flags: {},
            handshake: prepared.handshake,
        })
        const url = new URL(authorized.authorizeUrl)

        expect(fetchImpl.mock.calls[0][0]).toBe('https://staging.todoist.com/oauth/register')
        expect(url.origin).toBe('https://staging.todoist.com')
        expect(url.searchParams.get('resource')).toBe('https://comms.staging.todoist.com')
        expect(url.searchParams.get('scope')).toBe('user:read comms:content:read')
    })

    it('exchanges authorization codes as a public client and includes the Comms resource', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse({
                access_token: 'tdc_access',
                refresh_token: 'refresh_123',
                expires_in: 3600,
                scope: 'user:read comms:content:read',
            }),
        )

        const handshake = {
            oauthClientId: 'tdd_123',
            codeVerifier: 'verifier_123',
            authBaseUrl: 'https://todoist.com',
            authorizationUrl: 'https://todoist.com/oauth/authorize',
            tokenUrl: 'https://todoist.com/oauth/access_token',
            registrationUrl: 'https://todoist.com/oauth/register',
            resource: 'https://comms.todoist.com',
        }
        const exchange = await createCommsAuthProvider(fetchImpl).exchangeCode({
            code: 'code_123',
            state: 'state_123',
            redirectUri: 'http://localhost:8766/callback',
            handshake,
        })
        const body = formBody(fetchImpl.mock.calls[0])

        expect(fetchImpl.mock.calls[0][0]).toBe('https://todoist.com/oauth/access_token')
        expect(body.get('grant_type')).toBe('authorization_code')
        expect(body.get('client_id')).toBe('tdd_123')
        expect(body.get('client_secret')).toBeNull()
        expect(body.get('code_verifier')).toBe('verifier_123')
        expect(body.get('resource')).toBe('https://comms.todoist.com')
        expect(exchange.accessToken).toBe('tdc_access')
        expect(exchange.refreshToken).toBe('refresh_123')
        expect(exchange.expiresAt).toEqual(expect.any(Number))
        expect((exchange as typeof exchange & { scope?: string }).scope).toBe(
            'user:read comms:content:read',
        )
        expect(handshake).toMatchObject({
            grantedScope: 'user:read comms:content:read',
            tokenResponseExpiresIn: 3600,
            tokenResponseHasRefreshToken: true,
            tokenResponseScope: 'user:read comms:content:read',
        })
    })

    it('refreshes access tokens with the stored public client id and Comms resource', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse({
                access_token: 'tdc_fresh',
                refresh_token: 'refresh_rotated',
                expires_in: 3600,
                scope: 'user:read comms:content:read',
            }),
        )

        const exchange = await createCommsAuthProvider(fetchImpl).refreshToken!({
            refreshToken: 'refresh_old',
            handshake: {
                oauthClientId: 'tdd_123',
                authBaseUrl: 'https://todoist.com',
                authorizationUrl: 'https://todoist.com/oauth/authorize',
                tokenUrl: 'https://todoist.com/oauth/access_token',
                registrationUrl: 'https://todoist.com/oauth/register',
                resource: 'https://comms.todoist.com',
                grantedScope: READ_WRITE_SCOPES.join(' '),
            },
        })
        const body = formBody(fetchImpl.mock.calls[0])

        expect(body.get('grant_type')).toBe('refresh_token')
        expect(body.get('client_id')).toBe('tdd_123')
        expect(body.get('client_secret')).toBeNull()
        expect(body.get('refresh_token')).toBe('refresh_old')
        expect(body.get('resource')).toBe('https://comms.todoist.com')
        expect(exchange.accessToken).toBe('tdc_fresh')
        expect(exchange.refreshToken).toBe('refresh_rotated')
    })

    it('keeps stored account scope metadata when a refresh response omits scope', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse({
                access_token: 'tdc_fresh',
                expires_in: 3600,
            }),
        )

        const exchange = await createCommsAuthProvider(fetchImpl).refreshToken!({
            refreshToken: 'refresh_old',
            handshake: {
                oauthClientId: 'tdd_123',
                accountId: '42',
                accountLabel: 'Ada',
                authScope: READ_WRITE_SCOPES.join(' '),
                authBaseUrl: 'https://todoist.com',
                authorizationUrl: 'https://todoist.com/oauth/authorize',
                tokenUrl: 'https://todoist.com/oauth/access_token',
                registrationUrl: 'https://todoist.com/oauth/register',
                resource: 'https://comms.todoist.com',
            },
        })

        expect(exchange.account).toEqual({
            id: '42',
            label: 'Ada',
            authMode: 'read-write',
            authScope: READ_WRITE_SCOPES.join(' '),
            oauthClientId: 'tdd_123',
            authBaseUrl: 'https://todoist.com',
            authResource: 'https://comms.todoist.com',
        })
    })

    it('translates invalid_grant refresh failures into AUTH_REFRESH_EXPIRED', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse(
                {
                    error: 'invalid_grant',
                    error_description: 'Refresh token expired',
                },
                { status: 400 },
            ),
        )

        await expect(
            createCommsAuthProvider(fetchImpl).refreshToken!({
                refreshToken: 'refresh_old',
                handshake: {
                    oauthClientId: 'tdd_123',
                    authBaseUrl: 'https://todoist.com',
                    authorizationUrl: 'https://todoist.com/oauth/authorize',
                    tokenUrl: 'https://todoist.com/oauth/access_token',
                    registrationUrl: 'https://todoist.com/oauth/register',
                    resource: 'https://comms.todoist.com',
                },
            }),
        ).rejects.toMatchObject({
            code: 'AUTH_REFRESH_EXPIRED',
            message: 'Refresh token rejected: invalid_grant (Refresh token expired)',
        })
    })

    it('validate builds a CommsAccount, deriving read-write mode + scopes from the handshake', async () => {
        mockCreateClient.mockReturnValue({
            users: { getSessionUser: vi.fn().mockResolvedValue({ id: 42, fullName: 'Ada' }) },
        } as unknown as ReturnType<typeof createWrappedCommsClient>)

        const account = await createCommsAuthProvider().validateToken!({
            token: 'tk_new',
            handshake: {
                readOnly: false,
                oauthClientId: 'tdd_123',
                authBaseUrl: 'https://todoist.com',
                authorizationUrl: 'https://todoist.com/oauth/authorize',
                tokenUrl: 'https://todoist.com/oauth/access_token',
                registrationUrl: 'https://todoist.com/oauth/register',
                resource: 'https://comms.todoist.com',
                grantedScope: READ_WRITE_SCOPES.join(' '),
            },
        })

        expect(mockCreateClient).toHaveBeenCalledWith('tk_new', {
            baseUrl: 'https://comms.todoist.com',
        })
        expect(account).toEqual({
            id: '42',
            label: 'Ada',
            authMode: 'read-write',
            authScope: READ_WRITE_SCOPES.join(' '),
            oauthClientId: 'tdd_123',
            authBaseUrl: 'https://todoist.com',
            authResource: 'https://comms.todoist.com',
        })
    })

    it('validate includes Todoist token response diagnostics when Comms rejects OAuth', async () => {
        mockCreateClient.mockReturnValue({
            users: { getSessionUser: vi.fn().mockRejectedValue({ code: 'FORBIDDEN' }) },
        } as unknown as ReturnType<typeof createWrappedCommsClient>)

        await expect(
            createCommsAuthProvider().validateToken!({
                token: 'tk_forbidden',
                handshake: {
                    readOnly: false,
                    oauthClientId: 'tdd_123',
                    authBaseUrl: 'https://todoist.com',
                    authorizationUrl: 'https://todoist.com/oauth/authorize',
                    tokenUrl: 'https://todoist.com/oauth/access_token',
                    registrationUrl: 'https://todoist.com/oauth/register',
                    resource: 'https://comms.todoist.com',
                    grantedScope: READ_WRITE_SCOPES.join(' '),
                    tokenResponseExpiresIn: 315360000,
                    tokenResponseHasRefreshToken: false,
                    tokenResponseAccessTokenShape: 'shape=other, length=61',
                    tokenResponseScope: READ_WRITE_SCOPES.join(' '),
                },
            }),
        ).rejects.toMatchObject({
            code: 'AUTH_FAILED',
            message: 'Comms rejected the OAuth token during validation.',
            hints: expect.arrayContaining([
                'Todoist token response: expires_in=315360000, refresh_token=no',
                'Todoist token response access_token: shape=other, length=61',
                `Todoist token response scope: ${READ_WRITE_SCOPES.join(' ')}`,
                'Todoist issued a non-refresh access token; Comms intentionally rejects tokens without expiring introspection.',
            ]),
        })
    })

    it('validate fails closed (AUTH_FAILED) when the handshake has no boolean readOnly flag', async () => {
        // Guards the local write check: a missing flag must not silently become read-write.
        await expect(
            createCommsAuthProvider().validateToken!({ token: 'tk', handshake: {} }),
        ).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    })
})

describe('createCommsTokenStore', () => {
    beforeEach(() => {
        keyringMocks.createKeyringTokenStore.mockClear()
        keyringMocks.inner.active.mockReset()
        keyringMocks.inner.activeBundle.mockReset().mockResolvedValue(null)
        keyringMocks.inner.activeAccount.mockReset().mockResolvedValue(null)
        keyringMocks.inner.set.mockReset().mockResolvedValue(undefined)
        keyringMocks.inner.setBundle.mockReset().mockResolvedValue(undefined)
        keyringMocks.inner.clear.mockReset().mockResolvedValue(undefined)
        keyringMocks.inner.list.mockReset().mockResolvedValue([])
        keyringMocks.inner.setDefault.mockReset().mockResolvedValue(undefined)
        configMocks.getConfig.mockReset().mockResolvedValue({})
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('passes comms-cli wiring to cli-core: serviceName, no accountForUser override (uses cli-core default `user-${id}`), records location, and the parseRef-aware matcher', async () => {
        const createCommsTokenStore = await loadCreateCommsTokenStore()
        createCommsTokenStore()

        const options = keyringMocks.createKeyringTokenStore.mock.calls[0][0]
        expect(options.serviceName).toBe('comms-cli')
        expect(options.accountForUser).toBeUndefined()
        expect(options.recordsLocation).toBe('/home/user/.config/comms-cli/config.json')
        const { matchCommsAccount: matcher } = await import('./auth-provider.js')
        expect(options.matchAccount).toBe(matcher)
    })

    it('active() short-circuits to COMMS_API_TOKEN when no explicit ref is supplied', async () => {
        vi.stubEnv(TOKEN_ENV_VAR, 'env_token_value')
        const createCommsTokenStore = await loadCreateCommsTokenStore()

        const snapshot = await createCommsTokenStore().active()

        expect(snapshot).toEqual({
            token: 'env_token_value',
            account: { id: '', label: '', authMode: 'unknown', authScope: '' },
        })
        expect(keyringMocks.inner.active).not.toHaveBeenCalled()
    })

    it('active() ignores COMMS_API_TOKEN when an explicit --user ref targets a stored account', async () => {
        vi.stubEnv(TOKEN_ENV_VAR, 'env_token_value')
        keyringMocks.inner.active.mockResolvedValue({ token: 'tk_stored', account: STORED_ACCOUNT })
        const createCommsTokenStore = await loadCreateCommsTokenStore()

        await createCommsTokenStore().active('42')

        expect(keyringMocks.inner.active).toHaveBeenCalledWith('42')
    })

    it('delegates to the cli-core store when no env token is set', async () => {
        keyringMocks.inner.active.mockResolvedValue({ token: 'tk_v2', account: STORED_ACCOUNT })
        const createCommsTokenStore = await loadCreateCommsTokenStore()

        const snapshot = await createCommsTokenStore().active()

        expect(snapshot).toEqual({ token: 'tk_v2', account: STORED_ACCOUNT })
    })

    // cli-core's auth commands read the live credential via activeBundle(), so it
    // must apply the same env-token override as active() — otherwise `tdc auth
    // status` mis-reports env-token users.
    it('activeBundle() short-circuits to COMMS_API_TOKEN, wrapped as a bundle', async () => {
        vi.stubEnv(TOKEN_ENV_VAR, 'env_token_value')
        const createCommsTokenStore = await loadCreateCommsTokenStore()

        const snapshot = await createCommsTokenStore().activeBundle()

        expect(snapshot).toEqual({
            account: { id: '', label: '', authMode: 'unknown', authScope: '' },
            bundle: { accessToken: 'env_token_value' },
        })
        expect(keyringMocks.inner.activeBundle).not.toHaveBeenCalled()
    })

    it('activeBundle() delegates to the cli-core store when no env token is set', async () => {
        keyringMocks.inner.activeBundle.mockResolvedValue({
            account: STORED_ACCOUNT,
            bundle: { accessToken: 'tk_v2' },
        })
        const createCommsTokenStore = await loadCreateCommsTokenStore()

        const snapshot = await createCommsTokenStore().activeBundle('42')

        expect(snapshot).toEqual({ account: STORED_ACCOUNT, bundle: { accessToken: 'tk_v2' } })
        expect(keyringMocks.inner.activeBundle).toHaveBeenCalledWith('42')
    })

    // cli-core's `account current` resolves token-free via activeAccount(); an
    // env-token session isn't a v2 store account, so it must report `null` (the
    // attacher then routes to its env-notice hook). Mirrors active()/activeBundle().
    it('activeAccount() short-circuits to null when COMMS_API_TOKEN is set', async () => {
        vi.stubEnv(TOKEN_ENV_VAR, 'env_token_value')
        const createCommsTokenStore = await loadCreateCommsTokenStore()

        const result = await createCommsTokenStore().activeAccount()

        expect(result).toBeNull()
        expect(keyringMocks.inner.activeAccount).not.toHaveBeenCalled()
    })

    it('activeAccount() delegates to the cli-core store when no env token is set', async () => {
        keyringMocks.inner.activeAccount.mockResolvedValue({
            account: STORED_ACCOUNT,
            isDefault: true,
        })
        const createCommsTokenStore = await loadCreateCommsTokenStore()

        const result = await createCommsTokenStore().activeAccount('42')

        expect(result).toEqual({ account: STORED_ACCOUNT, isDefault: true })
        expect(keyringMocks.inner.activeAccount).toHaveBeenCalledWith('42')
    })

    it('set/setBundle/clear/list/setDefault delegate to the cli-core store', async () => {
        const createCommsTokenStore = await loadCreateCommsTokenStore()
        const store = createCommsTokenStore()
        const bundle = { accessToken: 'tk_bundle', refreshToken: 'rt_bundle' }

        await store.set(STORED_ACCOUNT, 'tk_new')
        await store.setBundle(STORED_ACCOUNT, bundle, { promoteDefault: true })
        await store.clear('42')
        await store.list()
        await store.setDefault('42')

        expect(keyringMocks.inner.set).toHaveBeenCalledWith(STORED_ACCOUNT, 'tk_new')
        expect(keyringMocks.inner.setBundle).toHaveBeenCalledWith(STORED_ACCOUNT, bundle, {
            promoteDefault: true,
        })
        expect(keyringMocks.inner.clear).toHaveBeenCalledWith('42')
        expect(keyringMocks.inner.list).toHaveBeenCalledTimes(1)
        expect(keyringMocks.inner.setDefault).toHaveBeenCalledWith('42')
    })
})

describe('matchCommsAccount', () => {
    it('matches numeric ids, `id:<n>` prefix form, and case-insensitive labels', () => {
        expect(matchCommsAccount(STORED_ACCOUNT, '42')).toBe(true)
        expect(matchCommsAccount(STORED_ACCOUNT, 'id:42')).toBe(true)
        expect(matchCommsAccount(STORED_ACCOUNT, 'ADA')).toBe(true)
        expect(matchCommsAccount(STORED_ACCOUNT, '999')).toBe(false)
        expect(matchCommsAccount(STORED_ACCOUNT, 'someone-else')).toBe(false)
    })

    it('never matches an identity-less manual-token account, even for empty-ish refs', () => {
        const manual = { id: '', label: '', authMode: 'unknown' as const, authScope: '' }
        // An empty `name` ref or bare `id:` would otherwise match the empty
        // id/label — guard so `account use|remove ""` can't target it.
        expect(matchCommsAccount(manual, '')).toBe(false)
        expect(matchCommsAccount(manual, 'id:')).toBe(false)
        expect(matchCommsAccount(manual, 'id:42')).toBe(false)
    })
})

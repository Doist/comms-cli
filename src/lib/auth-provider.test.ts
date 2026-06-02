import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({ createWrappedCommsClient: vi.fn() }))

const keyringMocks = vi.hoisted(() => ({
    createKeyringTokenStore: vi.fn(),
    inner: {
        active: vi.fn(),
        activeBundle: vi.fn(),
        activeAccount: vi.fn(),
        set: vi.fn(),
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
}))

vi.mock('./config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./config.js')>()
    return {
        ...actual,
        getConfigPath: () => '/home/user/.config/comms-cli/config.json',
        getConfig: configMocks.getConfig,
    }
})

import { createWrappedCommsClient } from './api.js'
import {
    AUTHORIZATION_URL,
    createCommsAuthProvider,
    matchCommsAccount,
    OAUTH_RESOURCE,
    READ_ONLY_SCOPES,
    READ_WRITE_SCOPES,
    REGISTRATION_URL,
    TOKEN_URL,
} from './auth-provider.js'

const mockCreateClient = vi.mocked(createWrappedCommsClient)
const TOKEN_ENV_VAR = 'COMMS_API_TOKEN'

const STORED_ACCOUNT = {
    id: '42',
    label: 'Ada',
    authMode: 'read-write' as const,
    authScope: 'user:read',
}

async function loadCreateCommsTokenStore(): Promise<
    typeof import('./auth-provider.js').createCommsTokenStore
> {
    vi.resetModules()
    const mod = await import('./auth-provider.js')
    return mod.createCommsTokenStore
}

describe('createCommsAuthProvider', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
        fetchMock.mockReset()
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.clearAllMocks()
        vi.unstubAllGlobals()
    })

    it('registers a Todoist dynamic client with client_secret_post', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ client_id: 'tdd_cli', client_secret: 'secret' }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            }),
        )

        const result = await createCommsAuthProvider().prepare!({
            redirectUri: 'http://localhost:8766/callback',
            flags: {},
        })

        expect(result.handshake).toEqual({ clientId: 'tdd_cli', clientSecret: 'secret' })
        expect(fetchMock).toHaveBeenCalledWith(
            REGISTRATION_URL,
            expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
        )
        const [, init] = fetchMock.mock.calls[0]
        const body = JSON.parse(init.body)
        expect(body).toMatchObject({
            redirect_uris: ['http://localhost:8766/callback'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_post',
            application_type: 'native',
            client_name: 'Comms CLI',
        })
    })

    it('adds the Comms resource indicator to the Todoist authorize URL', async () => {
        const result = await createCommsAuthProvider().authorize({
            redirectUri: 'http://localhost:8766/callback',
            state: 'state-123',
            scopes: READ_ONLY_SCOPES,
            readOnly: true,
            flags: {},
            handshake: { clientId: 'tdd_cli', clientSecret: 'secret' },
        })

        const url = new URL(result.authorizeUrl)
        expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZATION_URL)
        expect(url.searchParams.get('client_id')).toBe('tdd_cli')
        expect(url.searchParams.get('response_type')).toBe('code')
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8766/callback')
        expect(url.searchParams.get('scope')).toBe(READ_ONLY_SCOPES.join(','))
        expect(url.searchParams.get('state')).toBe('state-123')
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
        expect(url.searchParams.get('code_challenge')).toEqual(expect.any(String))
        expect(url.searchParams.get('resource')).toBe(OAUTH_RESOURCE)
        expect(result.handshake).toEqual({ codeVerifier: expect.any(String) })
        expect(result.handshake.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('passes client credentials and resource to the Todoist token endpoint', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ access_token: 'tk_new', expires_in: 3600 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        )

        const provider = createCommsAuthProvider()
        const preparedHandshake = {
            clientId: 'tdd_cli',
            clientSecret: 'secret',
        }
        const authorize = await provider.authorize({
            redirectUri: 'http://localhost:8766/callback',
            state: 'state-123',
            scopes: READ_ONLY_SCOPES,
            readOnly: true,
            flags: {},
            handshake: preparedHandshake,
        })

        const result = await provider.exchangeCode({
            code: 'auth-code',
            state: 'state-123',
            redirectUri: 'http://localhost:8766/callback',
            handshake: { ...preparedHandshake, ...authorize.handshake },
        })

        expect(result.accessToken).toBe('tk_new')
        expect(result.expiresAt).toEqual(expect.any(Number))
        expect(fetchMock).toHaveBeenCalledWith(
            TOKEN_URL,
            expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
        )
        const [, init] = fetchMock.mock.calls[0]
        const body = new URLSearchParams(init.body)
        expect(body.get('grant_type')).toBe('authorization_code')
        expect(body.get('code')).toBe('auth-code')
        expect(body.get('redirect_uri')).toBe('http://localhost:8766/callback')
        expect(body.get('client_id')).toBe('tdd_cli')
        expect(body.get('client_secret')).toBe('secret')
        expect(body.get('code_verifier')).toBe(authorize.handshake.codeVerifier)
        expect(body.get('resource')).toBe(OAUTH_RESOURCE)
    })

    // The comms-specific validation behavior: probe getSessionUser, then derive
    // authMode + authScope from the folded `readOnly` flag.
    it('validate builds a CommsAccount, deriving read-write mode + scopes from the handshake', async () => {
        mockCreateClient.mockReturnValue({
            users: { getSessionUser: vi.fn().mockResolvedValue({ id: 42, fullName: 'Ada' }) },
        } as unknown as ReturnType<typeof createWrappedCommsClient>)

        const account = await createCommsAuthProvider().validateToken!({
            token: 'tk_new',
            handshake: { readOnly: false },
        })

        expect(mockCreateClient).toHaveBeenCalledWith('tk_new')
        expect(account).toEqual({
            id: '42',
            label: 'Ada',
            authMode: 'read-write',
            authScope: READ_WRITE_SCOPES.join(' '),
        })
    })

    it('validate derives read-only mode + scopes when the handshake carries readOnly', async () => {
        mockCreateClient.mockReturnValue({
            users: { getSessionUser: vi.fn().mockResolvedValue({ id: 7, fullName: 'Lin' }) },
        } as unknown as ReturnType<typeof createWrappedCommsClient>)

        const account = await createCommsAuthProvider().validateToken!({
            token: 'tk_ro',
            handshake: { readOnly: true },
        })

        expect(account.authMode).toBe('read-only')
        expect(account.authScope).toBe(READ_ONLY_SCOPES.join(' '))
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

    it('set/clear/list/setDefault delegate to the cli-core store', async () => {
        const createCommsTokenStore = await loadCreateCommsTokenStore()
        const store = createCommsTokenStore()

        await store.set(STORED_ACCOUNT, 'tk_new')
        await store.clear('42')
        await store.list()
        await store.setDefault('42')

        expect(keyringMocks.inner.set).toHaveBeenCalledWith(STORED_ACCOUNT, 'tk_new')
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

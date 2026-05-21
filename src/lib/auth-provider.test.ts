import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({ createWrappedCommsClient: vi.fn() }))

const keyringMocks = vi.hoisted(() => ({
    createKeyringTokenStore: vi.fn(),
    inner: {
        active: vi.fn(),
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
    READ_ONLY_SCOPES,
    READ_WRITE_SCOPES,
    REGISTRATION_URL,
    TOKEN_URL,
} from './auth-provider.js'

const REDIRECT_URI = 'http://127.0.0.1:8766/callback'
const mockCreateClient = vi.mocked(createWrappedCommsClient)
const TOKEN_ENV_VAR = 'COMMS_API_TOKEN'

const STORED_ACCOUNT = {
    id: '42',
    label: 'Ada',
    authMode: 'read-write' as const,
    authScope: 'user:read',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

async function loadCreateCommsTokenStore(): Promise<
    typeof import('./auth-provider.js').createCommsTokenStore
> {
    vi.resetModules()
    const mod = await import('./auth-provider.js')
    return mod.createCommsTokenStore
}

describe('createCommsAuthProvider', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, 'fetch')
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('prepare POSTs the DCR payload and surfaces clientId/clientSecret on the handshake', async () => {
        fetchSpy.mockResolvedValue(json({ client_id: 'twd_abc', client_secret: 'shh' }))

        const result = await createCommsAuthProvider().prepare!({
            redirectUri: REDIRECT_URI,
            flags: {},
        })

        const [url, init] = fetchSpy.mock.calls[0]
        expect(url).toBe(REGISTRATION_URL)
        expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
            client_name: 'Comms CLI',
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_method: 'client_secret_basic',
        })
        expect(result.handshake).toEqual({ clientId: 'twd_abc', clientSecret: 'shh' })
    })

    it('prepare rewraps fetch rejections + bad responses as AUTH_FAILED', async () => {
        const provider = createCommsAuthProvider()
        const ctx = { redirectUri: REDIRECT_URI, flags: {} }

        fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'))
        await expect(provider.prepare!(ctx)).rejects.toMatchObject({ code: 'AUTH_FAILED' })

        fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 500 }))
        await expect(provider.prepare!(ctx)).rejects.toMatchObject({ code: 'AUTH_FAILED' })

        fetchSpy.mockResolvedValueOnce(json({ client_id: 'only' }))
        await expect(provider.prepare!(ctx)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    })

    it('authorize builds the Comms URL with PKCE params and threads verifier + authMode forward', async () => {
        const result = await createCommsAuthProvider().authorize({
            redirectUri: REDIRECT_URI,
            state: 'state-xyz',
            scopes: READ_WRITE_SCOPES,
            readOnly: false,
            flags: {},
            handshake: { clientId: 'twd_abc', clientSecret: 'shh' },
        })

        const url = new URL(result.authorizeUrl)
        expect(result.authorizeUrl.startsWith(AUTHORIZATION_URL)).toBe(true)
        expect(url.searchParams.get('client_id')).toBe('twd_abc')
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
        expect(url.searchParams.get('code_challenge')).toBeTruthy()
        expect(url.searchParams.get('scope')).toBe(READ_WRITE_SCOPES.join(' '))

        const hs = result.handshake as Record<string, unknown>
        expect((hs.codeVerifier as string).length).toBeGreaterThan(40)
        expect(hs.authMode).toBe('read-write')
    })

    it('authorize marks authMode read-only when readOnly is true', async () => {
        const result = await createCommsAuthProvider().authorize({
            redirectUri: REDIRECT_URI,
            state: 's',
            scopes: READ_ONLY_SCOPES,
            readOnly: true,
            flags: {},
            handshake: { clientId: 'c', clientSecret: 's' },
        })
        expect((result.handshake as Record<string, unknown>).authMode).toBe('read-only')
    })

    it('exchangeCode POSTs to the token endpoint with HTTP Basic auth and the PKCE verifier', async () => {
        fetchSpy.mockResolvedValue(json({ access_token: 'tk_123' }))

        const result = await createCommsAuthProvider().exchangeCode({
            code: 'auth-code',
            state: 's',
            redirectUri: REDIRECT_URI,
            handshake: { clientId: 'twd_abc', clientSecret: 'shh', codeVerifier: 'verif-1' },
        })

        expect(result).toEqual({ accessToken: 'tk_123' })
        const [url, init] = fetchSpy.mock.calls[0]
        expect(url).toBe(TOKEN_URL)
        const headers = (init as RequestInit).headers as Record<string, string>
        expect(headers.Authorization).toBe(`Basic ${Buffer.from('twd_abc:shh').toString('base64')}`)
        const body = new URLSearchParams((init as RequestInit).body as string)
        expect(body.get('code')).toBe('auth-code')
        expect(body.get('code_verifier')).toBe('verif-1')
    })

    it('exchangeCode rewraps fetch rejections, bad responses, and missing-verifier as AUTH_FAILED', async () => {
        const provider = createCommsAuthProvider()
        const goodHs = { clientId: 'a', clientSecret: 'b', codeVerifier: 'v' }
        const base = { code: 'c', state: 's', redirectUri: REDIRECT_URI }

        fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'))
        await expect(provider.exchangeCode({ ...base, handshake: goodHs })).rejects.toMatchObject({
            code: 'AUTH_FAILED',
        })

        fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 400 }))
        await expect(provider.exchangeCode({ ...base, handshake: goodHs })).rejects.toMatchObject({
            code: 'AUTH_FAILED',
        })

        // Guard: missing verifier means authorize() was never run — never hits fetch.
        await expect(
            provider.exchangeCode({ ...base, handshake: { clientId: 'a', clientSecret: 'b' } }),
        ).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    })

    it('validateToken fetches getSessionUser with the new token and returns a narrow CommsAccount', async () => {
        mockCreateClient.mockReturnValue({
            users: { getSessionUser: vi.fn().mockResolvedValue({ id: 42, fullName: 'Ada' }) },
        } as unknown as ReturnType<typeof createWrappedCommsClient>)

        const account = await createCommsAuthProvider().validateToken({
            token: 'tk_new',
            handshake: { authMode: 'read-write', authScope: 'user:read' },
        })

        expect(mockCreateClient).toHaveBeenCalledWith('tk_new')
        expect(account).toEqual({
            id: '42',
            label: 'Ada',
            authMode: 'read-write',
            authScope: 'user:read',
        })
    })
})

describe('createCommsTokenStore', () => {
    beforeEach(() => {
        keyringMocks.createKeyringTokenStore.mockClear()
        keyringMocks.inner.active.mockReset()
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
})

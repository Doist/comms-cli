import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({ createWrappedCommsClient: vi.fn() }))

const keyringMocks = vi.hoisted(() => ({
    createKeyringTokenStore: vi.fn(),
    createDcrProvider: vi.fn(),
    inner: {
        active: vi.fn(),
        activeBundle: vi.fn(),
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
    // Delegate to the real factory so the returned provider works, while
    // capturing the options createCommsAuthProvider passes (asserted below).
    keyringMocks.createDcrProvider.mockImplementation((options) =>
        actual.createDcrProvider(options),
    )
    return {
        ...actual,
        createKeyringTokenStore: keyringMocks.createKeyringTokenStore,
        createDcrProvider: keyringMocks.createDcrProvider,
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
    createCommsAuthProvider,
    matchCommsAccount,
    READ_ONLY_SCOPES,
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

async function loadCreateCommsTokenStore(): Promise<
    typeof import('./auth-provider.js').createCommsTokenStore
> {
    vi.resetModules()
    const mod = await import('./auth-provider.js')
    return mod.createCommsTokenStore
}

describe('createCommsAuthProvider', () => {
    // clearAllMocks (not restoreAllMocks) so the createDcrProvider delegating
    // implementation set in the module mock survives between tests.
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('registers with client_secret_post so underscore client_ids survive token-endpoint auth', () => {
        createCommsAuthProvider()
        const options = keyringMocks.createDcrProvider.mock.calls.at(-1)?.[0]
        expect(options.clientMetadata.tokenEndpointAuthMethod).toBe('client_secret_post')
    })

    // Registration / authorize / token-exchange mechanics now live in cli-core's
    // createDcrProvider (covered by its own suite). The only comms-specific
    // behaviour is `validate`: probe getSessionUser, then derive authMode +
    // authScope from the folded `readOnly` (the scope set is a pure function of
    // it — see resolveScopes in login.ts).
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

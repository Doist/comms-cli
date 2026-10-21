import { CommsRequestError } from '@doist/comms-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CliError } from './errors.js'

// Hoisted mocks — shared across both describe blocks.
const getWorkspaceUsersMock = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const sdkMocks = vi.hoisted(() => ({
    createClient: vi.fn(),
    deleteChannel: vi.fn(),
    uploadAttachment: vi.fn(),
    addGroupUsers: vi.fn(),
}))

vi.mock('@doist/comms-sdk', async (importActual) => {
    // Only the client is faked. The error class and the helpers that inspect it
    // stay real, because the status mapping under test depends on them agreeing.
    const actual = await importActual<typeof import('@doist/comms-sdk')>()
    class CommsApi {
        channels = { deleteChannel: sdkMocks.deleteChannel }
        attachments = { upload: sdkMocks.uploadAttachment }
        groups = { addUsers: sdkMocks.addGroupUsers }
        workspaceUsers = { getWorkspaceUsers: getWorkspaceUsersMock }
        constructor(token?: string, options?: unknown) {
            sdkMocks.createClient(token, options)
        }
    }
    return { ...actual, CommsApi }
})

vi.mock('./auth.js', () => ({
    getApiTokenSnapshot: vi.fn().mockResolvedValue({
        token: 'test-token',
        account: {
            id: '42',
            label: 'Ada',
            authMode: 'read-write',
            authResource: 'https://comms.staging.todoist.com',
            authScope: '',
        },
    }),
    getAuthMetadata: vi.fn().mockResolvedValue({ authMode: 'full' }),
}))

// Mirror production: unknown methods default to the write path. The tests
// exercise `channels.deleteChannel` and `attachments.upload` as mutating;
// reads (getWorkspaceUsers) stay off the write path.
const permMocks = vi.hoisted(() => ({
    ensureMutationAllowed: vi.fn().mockResolvedValue(undefined),
    isMutatingMethod: vi.fn(
        (path: string) =>
            path === 'channels.deleteChannel' ||
            path === 'attachments.upload' ||
            path === 'groups.addUsers',
    ),
}))
vi.mock('./permissions.js', () => permMocks)

vi.mock('./spinner.js', () => ({
    withSpinner: <T>(_label: unknown, fn: () => Promise<T>) => fn(),
}))

vi.mock('./progress.js', () => ({
    getProgressTracker: () => ({ isEnabled: () => false, emitApiCall: vi.fn() }),
}))

const {
    clearApiClientCache,
    clearWorkspaceUserCache,
    createWrappedCommsClient,
    getCommsClient,
    getWorkspaceUsers,
} = await import('./api.js')

describe('getWorkspaceUsers', () => {
    beforeEach(() => {
        getWorkspaceUsersMock.mockClear()
        clearApiClientCache()
        clearWorkspaceUserCache()
    })

    it('passes includeRemoved: undefined by default so the SDK applies its default filter', async () => {
        await getWorkspaceUsers(1585)
        expect(getWorkspaceUsersMock).toHaveBeenCalledWith({
            workspaceId: 1585,
            includeRemoved: undefined,
        })
    })

    it('forwards includeRemoved: true to the SDK', async () => {
        await getWorkspaceUsers(1585, { includeRemoved: true })
        expect(getWorkspaceUsersMock).toHaveBeenCalledWith({
            workspaceId: 1585,
            includeRemoved: true,
        })
    })

    it('caches active and include-removed variants separately', async () => {
        // First call seeds the active-only cache entry.
        await getWorkspaceUsers(1585)
        // Second call (same workspace, default flag) must hit cache → no extra SDK call.
        await getWorkspaceUsers(1585)
        expect(getWorkspaceUsersMock).toHaveBeenCalledTimes(1)

        // Switching to include-removed must NOT collide with the active entry.
        await getWorkspaceUsers(1585, { includeRemoved: true })
        expect(getWorkspaceUsersMock).toHaveBeenCalledTimes(2)
        expect(getWorkspaceUsersMock).toHaveBeenLastCalledWith({
            workspaceId: 1585,
            includeRemoved: true,
        })

        // And the include-removed variant is itself cached.
        await getWorkspaceUsers(1585, { includeRemoved: true })
        expect(getWorkspaceUsersMock).toHaveBeenCalledTimes(2)
    })
})

// ─── wrapResult — central 403 translation ────────────────────────────────────

describe('wrapResult — central 403 translation', () => {
    beforeEach(() => {
        clearApiClientCache()
        sdkMocks.createClient.mockReset()
        sdkMocks.deleteChannel.mockReset()
        sdkMocks.uploadAttachment.mockReset()
        sdkMocks.addGroupUsers.mockReset()
        permMocks.ensureMutationAllowed.mockReset().mockResolvedValue(undefined)
    })

    it('uses the explicit base URL when creating the wrapped SDK client', () => {
        createWrappedCommsClient('test-token', { baseUrl: 'https://comms.staging.todoist.com' })

        expect(sdkMocks.createClient).toHaveBeenCalledWith('test-token', {
            baseUrl: 'https://comms.staging.todoist.com',
            headers: {
                'Doist-Platform': 'cli',
                'Doist-Version': expect.stringMatching(/^\d+\.\d+\.\d+/),
            },
        })
    })

    it('uses the active OAuth account resource when creating the shared SDK client', async () => {
        await getCommsClient()

        expect(sdkMocks.createClient).toHaveBeenCalledWith('test-token', {
            baseUrl: 'https://comms.staging.todoist.com',
            headers: {
                'Doist-Platform': 'cli',
                'Doist-Version': expect.stringMatching(/^\d+\.\d+\.\d+/),
            },
        })
    })

    it('translates a plain 403 into a FORBIDDEN CliError', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 403', 403, {}),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH500')).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: 'Comms refused this action: 403 Forbidden.',
            hints: [
                'You may not have permission for this action',
                'Contact your workspace admin, or re-authenticate with `tdc auth login` if your token looks wrong',
            ],
        })
    })

    it('prefers INSUFFICIENT_SCOPE over FORBIDDEN when error_string indicates scope', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 403', 403, {
                error_string: 'Insufficient scope provided: channels:write',
            }),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH500')).rejects.toMatchObject({
            code: 'INSUFFICIENT_SCOPE',
            message: 'This action requires permissions your current token does not have.',
            hints: [
                'Run `tdc auth login` to re-authenticate with standard write scopes',
                'Use `tdc auth login --full-access` when the action deletes content or manages channels/workspaces',
            ],
        })
    })

    it('translates an attachments.upload scope 403 into INSUFFICIENT_SCOPE (re-login prompt)', async () => {
        permMocks.ensureMutationAllowed.mockResolvedValue(undefined)
        sdkMocks.uploadAttachment.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 403', 403, {
                error_string: 'Insufficient scope provided: attachments:write',
            }),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(
            client.attachments.upload({ file: new Blob(['x']), fileName: 'x.png' }),
        ).rejects.toMatchObject({
            code: 'INSUFFICIENT_SCOPE',
            message: 'This action requires permissions your current token does not have.',
            hints: [
                'Run `tdc auth login` to re-authenticate with standard write scopes',
                'Use `tdc auth login --full-access` when the action deletes content or manages channels/workspaces',
            ],
        })
        // Confirms upload runs through the mutating write-guard.
        expect(permMocks.ensureMutationAllowed).toHaveBeenCalled()
    })

    it('routes attachments.upload through the write-guard, blocking it in read-only mode', async () => {
        permMocks.ensureMutationAllowed.mockRejectedValueOnce(new Error('READ_ONLY'))
        const client = createWrappedCommsClient('test-token')

        await expect(
            client.attachments.upload({ file: new Blob(['x']), fileName: 'x.png' }),
        ).rejects.toThrow('READ_ONLY')
        // The SDK upload must never fire when the write-guard rejects.
        expect(sdkMocks.uploadAttachment).not.toHaveBeenCalled()
    })

    it('routes group membership writes through the mutation guard', async () => {
        permMocks.ensureMutationAllowed.mockRejectedValueOnce(new Error('INSUFFICIENT_SCOPE'))
        const client = createWrappedCommsClient('test-token')

        await expect(
            client.groups.addUsers({ id: 'G1', workspaceId: 69, userIds: [1] }),
        ).rejects.toThrow('INSUFFICIENT_SCOPE')
        // The guard runs before the request, so nothing hits the network.
        expect(sdkMocks.addGroupUsers).not.toHaveBeenCalled()
        expect(permMocks.ensureMutationAllowed).toHaveBeenCalledWith('groups.addUsers')
    })

    it('translates a 401 into INVALID_TOKEN with re-auth guidance', async () => {
        sdkMocks.addGroupUsers.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 401', 401, {
                error_string: 'Invalid token',
                error_code: 200,
            }),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(
            client.groups.addUsers({ id: 'G1', workspaceId: 69, userIds: [1] }),
        ).rejects.toMatchObject({
            code: 'INVALID_TOKEN',
            message: 'Comms rejected the token: 401.',
            hints: ['Re-authenticate with `tdc auth login`, then check `tdc auth status`'],
        })
    })

    it('gives the same 401 guidance on reads, which also route through wrapResult', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 401', 401, {}),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH500')).rejects.toMatchObject({
            code: 'INVALID_TOKEN',
            hints: ['Re-authenticate with `tdc auth login`, then check `tdc auth status`'],
        })
    })

    it('translates a 404 into NOT_FOUND', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 404', 404, {
                error_string: 'Resource not found',
                error_code: 110,
            }),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH404')).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: 'Comms could not find that resource: 404.',
            hints: ['Check the id, or pass the Comms URL instead'],
        })
    })

    it('translates a malformed-id 409 into INVALID_REF', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 409', 409, {
                error_string: 'id must decode to 16 bytes. Regenerate the ID and retry.',
                error_code: 217,
            }),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('nope')).rejects.toMatchObject({
            code: 'INVALID_REF',
            message:
                'Comms rejected the id: id must decode to 16 bytes. Regenerate the ID and retry.',
        })
    })

    it('gives a 217 without an error_string a readable message', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 409', 409, { error_code: 217 }),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('nope')).rejects.toMatchObject({
            code: 'INVALID_REF',
            message: 'Comms rejected the id: it does not decode to a Comms id (409)',
        })
    })

    it('translates any other 409 into CONFLICT, keeping the server message', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 409', 409, {
                error_string: 'Channel name already taken',
                error_code: 300,
            }),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH409')).rejects.toMatchObject({
            code: 'CONFLICT',
            message: 'Comms refused this request: Channel name already taken',
        })
    })

    it('translates a 400 into INVALID_REQUEST, keeping the server reason', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 400', 400, {
                error_string: 'Status message must be between 1 and 80 characters',
            }),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH400')).rejects.toMatchObject({
            code: 'INVALID_REQUEST',
            message:
                'Comms rejected the request: Status message must be between 1 and 80 characters',
        })
    })

    it.each([{}, { error_string: '' }, { error_string: 42 }, 'not json'])(
        'falls back to the readable 400 message when the body has no usable error_string (%j)',
        async (body) => {
            sdkMocks.deleteChannel.mockRejectedValueOnce(
                new CommsRequestError('Request failed with status 400', 400, body),
            )
            const client = createWrappedCommsClient('test-token')

            await expect(client.channels.deleteChannel('CH400')).rejects.toMatchObject({
                code: 'INVALID_REQUEST',
                message: 'Comms rejected the request: 400 Bad Request',
            })
        },
    )

    it('maps the edges of the 5xx range and nothing outside it', async () => {
        const client = createWrappedCommsClient('test-token')
        for (const [status, mapped] of [
            [499, false],
            [500, true],
            [599, true],
            [600, false],
        ] as const) {
            const original = new CommsRequestError(
                `Request failed with status ${status}`,
                status,
                {},
            )
            sdkMocks.deleteChannel.mockRejectedValueOnce(original)
            const error = await client.channels.deleteChannel('CHedge').catch((e: unknown) => e)
            if (mapped) {
                expect(error).toMatchObject({ code: 'API_ERROR' })
            } else {
                expect(error).toBe(original)
            }
        }
    })

    it('translates a 429 into RATE_LIMITED with a retry hint', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 429', 429, {}),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH429')).rejects.toMatchObject({
            code: 'RATE_LIMITED',
            message: 'Comms is rate limiting requests: 429 Too Many Requests.',
            hints: ['Wait a moment, then retry'],
        })
    })

    it.each([500, 502, 503])('translates a %i into API_ERROR', async (status) => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError(`Request failed with status ${status}`, status, {}),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH5xx')).rejects.toMatchObject({
            code: 'API_ERROR',
            message: `Comms had a server error: ${status}.`,
            hints: ['This is usually temporary, retry in a moment'],
        })
    })

    it('keeps the server body out of a 5xx message', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('Request failed with status 502', 502, {
                error_string: '<html>upstream connect error</html>',
            }),
        )
        const client = createWrappedCommsClient('test-token')

        const error = await client.channels.deleteChannel('CH502').catch((e: Error) => e)

        expect(error).toBeInstanceOf(CliError)
        expect(error).toMatchObject({
            code: 'API_ERROR',
            message: 'Comms had a server error: 502.',
        })
    })

    it('translates a request that never got a response into NETWORK_ERROR', async () => {
        sdkMocks.deleteChannel.mockRejectedValueOnce(
            new CommsRequestError('fetch failed (ENOTFOUND) after 4 attempts'),
        )
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CHnet')).rejects.toMatchObject({
            code: 'NETWORK_ERROR',
            message: 'Could not reach Comms: fetch failed (ENOTFOUND) after 4 attempts',
            hints: ['Check your network connection, then retry'],
        })
    })

    it('passes a non-Comms error through untranslated', async () => {
        const originalError = new TypeError('boom')
        sdkMocks.deleteChannel.mockRejectedValueOnce(originalError)
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CHx')).rejects.toBe(originalError)
    })

    it('passes unmapped errors through untranslated', async () => {
        const originalError = new CommsRequestError('Request failed with status 418', 418, {})
        sdkMocks.deleteChannel.mockRejectedValueOnce(originalError)
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH500')).rejects.toBe(originalError)
    })
})

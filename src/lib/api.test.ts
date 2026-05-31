import { CommsRequestError } from '@doist/comms-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks — shared across both describe blocks.
const getWorkspaceUsersMock = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const sdkMocks = vi.hoisted(() => ({
    deleteChannel: vi.fn(),
    uploadAttachment: vi.fn(),
}))

vi.mock('@doist/comms-sdk', () => {
    class CommsApi {
        channels = { deleteChannel: sdkMocks.deleteChannel }
        attachments = { upload: sdkMocks.uploadAttachment }
        workspaceUsers = { getWorkspaceUsers: getWorkspaceUsersMock }
        constructor(_token?: string) {}
    }
    return {
        CommsApi,
        CommsRequestError: class CommsRequestError extends Error {
            constructor(
                message: string,
                public httpStatusCode: number,
                public responseData?: unknown,
            ) {
                super(message)
            }
        },
    }
})

vi.mock('./auth.js', () => ({
    getApiToken: vi.fn().mockResolvedValue('test-token'),
    getAuthMetadata: vi.fn().mockResolvedValue({ authMode: 'full' }),
}))

// `channels.deleteChannel` is the only mutating method the 403-translation
// tests exercise; everything else (getWorkspaceUsers) stays on the read path.
vi.mock('./permissions.js', () => ({
    ensureWriteAllowed: vi.fn().mockResolvedValue(undefined),
    isMutatingMethod: vi.fn((path: string) => path === 'channels.deleteChannel'),
}))

vi.mock('./spinner.js', () => ({
    withSpinner: <T>(_label: unknown, fn: () => Promise<T>) => fn(),
}))

vi.mock('./progress.js', () => ({
    getProgressTracker: () => ({ isEnabled: () => false, emitApiCall: vi.fn() }),
}))

const { clearWorkspaceUserCache, createWrappedCommsClient, getWorkspaceUsers } =
    await import('./api.js')

describe('getWorkspaceUsers', () => {
    beforeEach(() => {
        getWorkspaceUsersMock.mockClear()
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
        sdkMocks.deleteChannel.mockReset()
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
            hints: ['Run `tdc auth login` to re-authenticate with the required scopes'],
        })
    })

    it('translates an attachments.upload scope 403 into INSUFFICIENT_SCOPE (re-login prompt)', async () => {
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
            hints: ['Run `tdc auth login` to re-authenticate with the required scopes'],
        })
    })

    it('passes non-403 errors through untranslated', async () => {
        const originalError = new CommsRequestError('Request failed with status 500', 500, {})
        sdkMocks.deleteChannel.mockRejectedValueOnce(originalError)
        const client = createWrappedCommsClient('test-token')

        await expect(client.channels.deleteChannel('CH500')).rejects.toBe(originalError)
    })
})

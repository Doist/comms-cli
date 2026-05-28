import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the SDK so we can observe how `getWorkspaceUsers` invokes
// `client.workspaceUsers.getWorkspaceUsers`. The real filtering of
// removed users lives in the SDK (≥0.3.0), so the contract this test
// guards is "we pass `includeRemoved` through unchanged."
const getWorkspaceUsersMock = vi.hoisted(() => vi.fn().mockResolvedValue([]))

vi.mock('@doist/comms-sdk', () => ({
    CommsApi: class {
        workspaceUsers = { getWorkspaceUsers: getWorkspaceUsersMock }
    },
}))

vi.mock('./auth.js', () => ({
    getApiToken: vi.fn().mockResolvedValue('test-token'),
}))

vi.mock('./permissions.js', () => ({
    ensureWriteAllowed: vi.fn(),
    isMutatingMethod: vi.fn().mockReturnValue(false),
}))

vi.mock('./spinner.js', () => ({
    withSpinner: <T>(_label: unknown, fn: () => Promise<T>) => fn(),
}))

vi.mock('./progress.js', () => ({
    getProgressTracker: () => ({ isEnabled: () => false, emitApiCall: vi.fn() }),
}))

const { clearWorkspaceUserCache, getWorkspaceUsers } = await import('./api.js')

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
})

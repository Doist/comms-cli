import type { Group } from '@doist/comms-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getWorkspaceGroups: vi.fn(),
    getGroup: vi.fn(),
    getWorkspaceUsers: vi.fn(),
}))

vi.mock('../../lib/api.js', () => apiMocks)

import { buildDefaultAudienceArgs } from './default-audience.js'

const groups: Group[] = [
    { id: 'GR1', name: 'Design', workspaceId: 69, userIds: [], version: 1 },
    { id: 'GR2', name: 'Backend', workspaceId: 69, userIds: [], version: 1 },
]

beforeEach(() => {
    vi.resetAllMocks()
    apiMocks.getWorkspaceGroups.mockResolvedValue(groups)
    apiMocks.getGroup.mockResolvedValue(groups[1])
})

describe('default audience group resolution', () => {
    it('shares one workspace list for multiple names and preserves input order', async () => {
        await expect(
            buildDefaultAudienceArgs({ defaultGroups: ' Back, design ' }, 69),
        ).resolves.toEqual({ useDefaultRecipients: true, defaultGroups: ['GR2', 'GR1'] })
        expect(apiMocks.getWorkspaceGroups.mock.calls).toEqual([[69]])
        expect(apiMocks.getGroup).not.toHaveBeenCalled()
    })

    it('does not fetch the workspace list for ID-only input', async () => {
        await expect(buildDefaultAudienceArgs({ defaultGroups: 'id:GR2' }, 69)).resolves.toEqual({
            useDefaultRecipients: true,
            defaultGroups: ['GR2'],
        })
        expect(apiMocks.getWorkspaceGroups).not.toHaveBeenCalled()
        expect(apiMocks.getGroup).toHaveBeenCalledWith('GR2', 69)
    })

    it('starts ID lookups without waiting for the shared name lookup', async () => {
        const pendingGroups = Promise.withResolvers<Group[]>()
        apiMocks.getWorkspaceGroups.mockReturnValue(pendingGroups.promise)
        const result = buildDefaultAudienceArgs({ defaultGroups: 'Design,id:GR2,Back' }, 69)

        expect(apiMocks.getGroup).toHaveBeenCalledWith('GR2', 69)
        pendingGroups.resolve(groups)

        await expect(result).resolves.toEqual({
            useDefaultRecipients: true,
            defaultGroups: ['GR1', 'GR2', 'GR2'],
        })
        expect(apiMocks.getWorkspaceGroups.mock.calls).toEqual([[69]])
    })

    it.each([
        { ref: 'Design', code: 'AMBIGUOUS_GROUP' },
        { ref: 'Marketing', code: 'GROUP_NOT_FOUND' },
    ])('preserves $code errors with a shared list', async ({ ref, code }) => {
        apiMocks.getWorkspaceGroups.mockResolvedValue([
            { ...groups[0], name: 'Design East' },
            { ...groups[1], name: 'Design West' },
        ])
        await expect(buildDefaultAudienceArgs({ defaultGroups: ref }, 69)).rejects.toHaveProperty(
            'code',
            code,
        )
    })
})

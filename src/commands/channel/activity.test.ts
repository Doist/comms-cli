import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    getCurrentWorkspaceId: vi.fn(),
}))

vi.mock('../../lib/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/api.js')>()),
    ...apiMocks,
}))

vi.mock('../../lib/global-args.js', async (importOriginal) => ({
    ...(await importOriginal()),
    includePrivateChannels: vi.fn().mockReturnValue(false),
}))

vi.mock('chalk')

import { registerChannelCommand } from './index.js'

const createProgram = () => createTestProgram(registerChannelCommand)

function makeChannel(id: string, name: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        name,
        workspaceId: 1,
        archived: false,
        public: true,
        created: new Date('2020-01-01T00:00:00Z'),
        ...overrides,
    }
}

function makeThread(channelId: string, lastUpdated: string) {
    return {
        id: `${channelId}-${lastUpdated}`,
        channelId,
        workspaceId: 1,
        lastUpdated: new Date(lastUpdated),
    }
}

function setupClient({
    publicChannels = [] as ReturnType<typeof makeChannel>[],
    joined = [] as ReturnType<typeof makeChannel>[],
    threadsByChannel = {} as Record<string, ReturnType<typeof makeThread>[]>,
} = {}) {
    const getThreads = vi.fn(({ channelId }: { channelId: string }) =>
        Promise.resolve(threadsByChannel[channelId] ?? []),
    )
    apiMocks.getCommsClient.mockResolvedValue({
        channels: { getChannels: vi.fn().mockResolvedValue(joined) },
        workspaces: { getPublicChannels: vi.fn().mockResolvedValue(publicChannels) },
        threads: { getThreads },
    })
    return { getThreads }
}

describe('channel activity', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
    })

    it('reports the newest thread lastUpdated per channel, newest first', async () => {
        setupClient({
            publicChannels: [makeChannel('A', 'Alpha'), makeChannel('B', 'Beta')],
            threadsByChannel: {
                A: [
                    makeThread('A', '2026-01-01T00:00:00Z'),
                    makeThread('A', '2026-03-01T00:00:00Z'),
                ],
                B: [makeThread('B', '2026-02-01T00:00:00Z')],
            },
        })
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'channel', 'activity', '--json'])

        const out = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(out.map((c: { name: string }) => c.name)).toEqual(['Alpha', 'Beta'])
        expect(out[0].lastActivityAt).toBe('2026-03-01T00:00:00.000Z')
        expect(out[0].threadCount).toBe(2)
    })

    it('reports null activity and a zero thread count for empty channels', async () => {
        setupClient({ publicChannels: [makeChannel('A', 'Empty')] })
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'channel', 'activity', '--json'])

        const out = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(out[0].lastActivityAt).toBeNull()
        expect(out[0].threadCount).toBe(0)
    })

    it('--inactive-since keeps only channels inactive since the date (empty falls back to created)', async () => {
        setupClient({
            publicChannels: [
                makeChannel('A', 'Active'),
                makeChannel('B', 'Stale'),
                makeChannel('C', 'EmptyOld', { created: new Date('2019-01-01T00:00:00Z') }),
            ],
            threadsByChannel: {
                A: [makeThread('A', '2026-06-01T00:00:00Z')],
                B: [makeThread('B', '2025-01-01T00:00:00Z')],
            },
        })
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'channel',
            'activity',
            '--inactive-since',
            '2026-04-16',
            '--json',
        ])

        const out = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(out.map((c: { name: string }) => c.name).sort()).toEqual(['EmptyOld', 'Stale'])
    })

    it('errors when both positional workspace and --workspace are provided', async () => {
        setupClient()

        await expect(
            createProgram().parseAsync([
                'node',
                'tdc',
                'channel',
                'activity',
                'Doist',
                '--workspace',
                'Other',
            ]),
        ).rejects.toThrow('Cannot specify workspace both as argument and --workspace flag')
    })

    it('rejects an invalid --inactive-since date', async () => {
        setupClient()

        await expect(
            createProgram().parseAsync([
                'node',
                'tdc',
                'channel',
                'activity',
                '--inactive-since',
                'not-a-date',
                '--json',
            ]),
        ).rejects.toThrow(/Invalid --inactive-since/)
    })
})

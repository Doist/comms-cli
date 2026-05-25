import {
    captureConsole,
    createTestProgram,
    describeEmptyMachineOutput,
} from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    getCurrentWorkspaceId: vi.fn(),
}))

vi.mock('../lib/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/api.js')>()),
    ...apiMocks,
}))

vi.mock('../lib/refs.js', () => ({
    resolveWorkspaceRef: vi.fn(),
}))

vi.mock('../lib/global-args.js', async (importOriginal) => ({
    ...(await importOriginal()),
    includePrivateChannels: vi.fn().mockReturnValue(true),
}))

vi.mock('../lib/public-channels.js', () => ({
    getPublicChannelIds: vi.fn(),
}))

vi.mock('chalk')

import { registerInboxCommand } from './inbox.js'

const createProgram = () => createTestProgram(registerInboxCommand)

function mockClient(overrides: {
    inboxThreads?: unknown[]
    unreadData?: unknown[]
    getChannel?: ReturnType<typeof vi.fn>
    getInbox?: ReturnType<typeof vi.fn>
    getUnread?: ReturnType<typeof vi.fn>
}) {
    const getInbox = overrides.getInbox ?? vi.fn().mockResolvedValue(overrides.inboxThreads ?? [])
    const getUnread =
        overrides.getUnread ??
        vi.fn().mockResolvedValue({ data: overrides.unreadData ?? [], version: 1 })
    const getChannel = overrides.getChannel ?? vi.fn()
    apiMocks.getCommsClient.mockResolvedValue({
        inbox: { getInbox },
        threads: { getUnread },
        channels: { getChannel },
    })
    return { getInbox, getUnread, getChannel }
}

describe('inbox --workspace conflict', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('errors when both positional and --workspace are provided', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'inbox', 'Doist', '--workspace', 'Other']),
        ).rejects.toThrow('Cannot specify workspace both as argument and --workspace flag')
    })
})

describe('inbox --archive-filter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
    })

    it('passes archiveFilter to SDK getInbox', async () => {
        const { getInbox } = mockClient({})
        const program = createProgram()
        await program.parseAsync(['node', 'tdc', 'inbox', '--archive-filter', 'all', '--json'])

        expect(getInbox).toHaveBeenCalledWith(expect.objectContaining({ archiveFilter: 'all' }))
    })

    it('defaults archiveFilter to active when not provided', async () => {
        const { getInbox } = mockClient({})
        const program = createProgram()
        await program.parseAsync(['node', 'tdc', 'inbox', '--json'])

        expect(getInbox).toHaveBeenCalledWith(expect.objectContaining({ archiveFilter: 'active' }))
    })

    it('maps --since to newerThan and --until to olderThan for getInbox', async () => {
        const { getInbox } = mockClient({})
        const program = createProgram()
        await program.parseAsync([
            'node',
            'tdc',
            'inbox',
            '--since',
            '2026-01-01',
            '--until',
            '2026-02-01',
            '--json',
        ])

        expect(getInbox).toHaveBeenCalledWith(
            expect.objectContaining({
                newerThan: new Date('2026-01-01'),
                olderThan: new Date('2026-02-01'),
            }),
        )
        const [args] = getInbox.mock.calls[0] as [Record<string, unknown>]
        expect(args).not.toHaveProperty('since')
        expect(args).not.toHaveProperty('until')
    })
})

describeEmptyMachineOutput('inbox empty output', {
    setup: () => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        mockClient({})
    },
    run: async (extraArgs) => {
        const program = createProgram()
        await program.parseAsync(['node', 'tdc', 'inbox', ...extraArgs])
    },
    humanMessage: 'No threads in inbox.',
})

describe('inbox empty output (channel filter)', () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        const thread = {
            id: 'TH1',
            channelId: 'CH10',
            title: 't',
            posted: '2026-05-01T00:00:00Z',
            url: 'http://example/t',
        }
        mockClient({
            inboxThreads: [thread],
            getChannel: vi.fn().mockResolvedValue({ id: 'CH10', name: 'engineering' }),
        })
        logSpy = captureConsole('log')
    })

    it('outputs [] for --json when --channel filter matches nothing', async () => {
        const program = createProgram()
        await program.parseAsync(['node', 'tdc', 'inbox', '--channel', 'nonexistent', '--json'])

        expect(logSpy).toHaveBeenCalledTimes(1)
        expect(logSpy).toHaveBeenCalledWith('[]')
    })
})

describe('inbox API errors', () => {
    it('propagates SDK rejections through the Promise.all that replaced batch', async () => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        mockClient({
            getInbox: vi.fn().mockRejectedValue(new Error('limit must be <= 500')),
        })
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'inbox', '--limit', '1000']),
        ).rejects.toThrow('limit must be <= 500')
    })
})

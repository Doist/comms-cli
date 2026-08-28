import {
    captureConsole,
    createTestProgram,
    describeEmptyMachineOutput,
} from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    getCurrentWorkspaceId: vi.fn().mockResolvedValue(1),
}))

const refsMocks = vi.hoisted(() => ({
    resolveWorkspaceRef: vi.fn(),
    resolveChannelRef: vi.fn(),
    parseRef: vi.fn(),
    getDirectChannelId: vi.fn(),
    resolveUserRefs: vi.fn(),
}))

const globalArgsMocks = vi.hoisted(() => ({
    includePrivateChannels: vi.fn().mockReturnValue(false),
    isAccessible: vi.fn().mockReturnValue(false),
}))

vi.mock('../../lib/api.js', () => ({
    getCommsClient: apiMocks.getCommsClient,
    getCurrentWorkspaceId: apiMocks.getCurrentWorkspaceId,
}))

vi.mock('../../lib/refs.js', () => ({
    resolveWorkspaceRef: refsMocks.resolveWorkspaceRef,
    resolveChannelRef: refsMocks.resolveChannelRef,
    parseRef: refsMocks.parseRef,
    getDirectChannelId: refsMocks.getDirectChannelId,
    resolveUserRefs: refsMocks.resolveUserRefs,
}))

vi.mock('../../lib/global-args.js', () => ({
    includePrivateChannels: globalArgsMocks.includePrivateChannels,
    isAccessible: globalArgsMocks.isAccessible,
}))

vi.mock('chalk')

import { registerChannelCommand } from './index.js'

const createProgram = () => createTestProgram(registerChannelCommand)

async function runChannelCommand(args: string[]): Promise<void> {
    const program = createProgram()
    await program.parseAsync(['node', 'tdc', 'channel', ...args])
}

function createChannel(id: number, name: string, overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id,
        name,
        public: true,
        workspaceId: 1,
        archived: false,
        creator: 1,
        created: new Date('2026-01-01T00:00:00Z'),
        version: 1,
        ...overrides,
    }
}

function createClient({
    joinedChannels = [],
    publicChannels = [],
    createdChannel,
    updatedChannel,
}: {
    joinedChannels?: ReturnType<typeof createChannel>[]
    publicChannels?: ReturnType<typeof createChannel>[]
    createdChannel?: ReturnType<typeof createChannel>
    updatedChannel?: ReturnType<typeof createChannel>
} = {}) {
    return {
        channels: {
            getChannels: vi.fn().mockResolvedValue(joinedChannels),
            getChannel: vi.fn(),
            createChannel: vi.fn().mockResolvedValue(createdChannel),
            updateChannel: vi.fn().mockResolvedValue(updatedChannel),
            deleteChannel: vi.fn().mockResolvedValue({ status: 'ok' }),
            archiveChannel: vi.fn().mockResolvedValue({ status: 'ok' }),
            unarchiveChannel: vi.fn().mockResolvedValue({ status: 'ok' }),
        },
        workspaces: {
            getPublicChannels: vi.fn().mockResolvedValue(publicChannels),
        },
    }
}

describe('channels list', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        globalArgsMocks.includePrivateChannels.mockReturnValue(false)
    })

    it('errors when both positional and --workspace are provided', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'channels', 'Doist', '--workspace', 'Other']),
        ).rejects.toThrow('Cannot specify workspace both as argument and --workspace flag')
    })

    it('lists joined public channels by default (via channels alias)', async () => {
        const client = createClient({
            joinedChannels: [
                createChannel(10, 'General'),
                createChannel(20, 'Leadership', { public: false }),
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channels'])

        expect(client.channels.getChannels).toHaveBeenCalledWith({
            workspaceId: 1,
            archived: false,
        })
        expect(client.workspaces.getPublicChannels).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledTimes(1)
        expect(consoleSpy.mock.calls[0][0]).toContain('General')
        expect(consoleSpy.mock.calls[0][0]).not.toContain('Leadership')
    })

    it('also works via the singular channel command name', async () => {
        const client = createClient({
            joinedChannels: [createChannel(10, 'General')],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel'])

        expect(client.channels.getChannels).toHaveBeenCalledWith({
            workspaceId: 1,
            archived: false,
        })
        expect(consoleSpy.mock.calls[0][0]).toContain('General')
    })

    it('supports explicit channel list subcommand', async () => {
        const client = createClient({
            joinedChannels: [createChannel(10, 'General')],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'list'])

        expect(client.channels.getChannels).toHaveBeenCalledWith({
            workspaceId: 1,
            archived: false,
        })
    })

    it('outputs one stable channel ID per line with --ids-only', async () => {
        const client = createClient({
            joinedChannels: [createChannel(10, 'General'), createChannel(20, 'Product')],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'channels', '--ids-only'])

        expect(consoleSpy).toHaveBeenCalledWith('10\n20')
    })

    it('rejects conflicting machine-output modes before fetching channels', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        await expect(
            createProgram().parseAsync(['node', 'tdc', 'channels', '--ids-only', '--json']),
        ).rejects.toThrow('Options --json, --ids-only are mutually exclusive.')
        expect(apiMocks.getCommsClient).not.toHaveBeenCalled()
    })

    it('includes joined private channels when --include-private-channels is enabled', async () => {
        globalArgsMocks.includePrivateChannels.mockReturnValue(true)
        const client = createClient({
            joinedChannels: [
                createChannel(10, 'General'),
                createChannel(20, 'Leadership', { public: false }),
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channels'])

        expect(consoleSpy).toHaveBeenCalledTimes(2)
        expect(client.channels.getChannels).toHaveBeenCalledWith({
            workspaceId: 1,
            archived: false,
        })
        expect(consoleSpy.mock.calls[1][0]).toContain('Leadership')
        expect(consoleSpy.mock.calls[1][0]).toContain('[private]')
    })

    it('lists active public channels and marks whether they are joined', async () => {
        const client = createClient({
            joinedChannels: [
                createChannel(10, 'General'),
                createChannel(20, 'Leadership', { public: false }),
            ],
            publicChannels: [
                createChannel(10, 'General'),
                createChannel(30, 'Marketing'),
                createChannel(40, 'Archive', { archived: true }),
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channels', '--scope', 'public'])

        expect(client.channels.getChannels).toHaveBeenCalledWith({ workspaceId: 1 })
        expect(client.workspaces.getPublicChannels).toHaveBeenCalledWith(1)
        expect(consoleSpy).toHaveBeenCalledTimes(2)
        expect(consoleSpy.mock.calls[0][0]).toContain('General')
        expect(consoleSpy.mock.calls[0][0]).toContain('[joined]')
        expect(consoleSpy.mock.calls[1][0]).toContain('Marketing')
        expect(consoleSpy.mock.calls[1][0]).toContain('[not joined]')
        expect(consoleSpy.mock.calls[0][0]).not.toContain('Archive')
    })

    it('lists only discoverable channels in JSON mode', async () => {
        const client = createClient({
            joinedChannels: [createChannel(10, 'General')],
            publicChannels: [createChannel(10, 'General'), createChannel(30, 'Marketing')],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channels', '--scope', 'discoverable', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual([
            { id: 30, name: 'Marketing', workspaceId: 1, archived: false, joined: false },
        ])
    })

    it('lists archived joined channels with --state archived', async () => {
        const client = createClient({
            joinedChannels: [createChannel(90, 'Old General', { archived: true })],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channels', '--state', 'archived'])

        expect(client.channels.getChannels).toHaveBeenCalledWith({ workspaceId: 1, archived: true })
        expect(consoleSpy).toHaveBeenCalledTimes(1)
        expect(consoleSpy.mock.calls[0][0]).toContain('Old General')
        expect(consoleSpy.mock.calls[0][0]).toContain('(archived)')
    })

    it('lists all visible public channels with --scope public --state all', async () => {
        const client = createClient({
            joinedChannels: [createChannel(10, 'General')],
            publicChannels: [
                createChannel(10, 'General'),
                createChannel(40, 'Archive', { archived: true }),
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channels',
            '--scope',
            'public',
            '--state',
            'all',
            '--json',
        ])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual([
            { id: 10, name: 'General', workspaceId: 1, archived: false, joined: true },
            { id: 40, name: 'Archive', workspaceId: 1, archived: true, joined: false },
        ])
    })

    it('includes archived state in joined JSON output without --full', async () => {
        const client = createClient({
            joinedChannels: [
                createChannel(10, 'General'),
                createChannel(40, 'Archive', { archived: true }),
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channels', '--state', 'all', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual([
            { id: 10, name: 'General', workspaceId: 1, archived: false },
            { id: 40, name: 'Archive', workspaceId: 1, archived: true },
        ])
    })

    it('includes archived state in joined NDJSON output without --full', async () => {
        const client = createClient({
            joinedChannels: [
                createChannel(10, 'General'),
                createChannel(40, 'Archive', { archived: true }),
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channels', '--state', 'all', '--ndjson'])

        const ndjsonOutput = consoleSpy.mock.calls[0][0]
            .split('\n')
            .map((line: string) => JSON.parse(line) as Record<string, unknown>)
        expect(ndjsonOutput).toEqual([
            { id: 10, name: 'General', workspaceId: 1, archived: false },
            { id: 40, name: 'Archive', workspaceId: 1, archived: true },
        ])
    })

    it('includes joined metadata in full JSON for public scope', async () => {
        const client = createClient({
            joinedChannels: [createChannel(10, 'General')],
            publicChannels: [createChannel(10, 'General', { description: 'Everyone' })],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channels',
            '--scope',
            'public',
            '--json',
            '--full',
        ])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput[0]).toMatchObject({
            id: 10,
            name: 'General',
            description: 'Everyone',
            joined: true,
        })
    })

    describeEmptyMachineOutput('empty machine output contract', {
        setup: () => {
            const client = createClient({ joinedChannels: [] })
            apiMocks.getCommsClient.mockResolvedValue(client)
        },
        run: async (extraArgs) => {
            const program = createProgram()
            await program.parseAsync(['node', 'tdc', 'channels', ...extraArgs])
        },
        humanMessage: 'No active channels found.',
        idsOnly: true,
    })

    it('shows a specific empty state when no active discoverable channels remain', async () => {
        const client = createClient({
            joinedChannels: [createChannel(10, 'General')],
            publicChannels: [
                createChannel(10, 'General'),
                createChannel(20, 'Old Team', { archived: true }),
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channels', '--scope', 'discoverable'])

        expect(consoleSpy).toHaveBeenCalledWith('No active discoverable channels found.')
    })

    it('rejects invalid scope values', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'channels', '--scope', 'invalid']),
        ).rejects.toHaveProperty('code', 'INVALID_SCOPE')
    })

    it('rejects invalid state values', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'channels', '--state', 'invalid']),
        ).rejects.toHaveProperty('code', 'INVALID_STATE')
    })
})

describe('channels create', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        refsMocks.parseRef.mockImplementation((ref: string) =>
            ref === 'Q3' ? { type: 'id', id: ref } : { type: 'name', name: ref },
        )
    })

    it('passes supported fields to createChannel', async () => {
        refsMocks.resolveWorkspaceRef.mockResolvedValue({ id: 9, name: 'Doist' })
        refsMocks.resolveUserRefs.mockResolvedValue([10, 20])
        const createdChannel = createChannel(200, 'Leadership', {
            id: 'CH200',
            public: false,
            workspaceId: 9,
        })
        const client = createClient({ createdChannel })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand([
            'create',
            'Leadership',
            '--workspace',
            'Doist',
            '--description',
            'Private leadership discussions',
            '--private',
            '--users',
            'id:10,id:20',
        ])

        expect(refsMocks.resolveWorkspaceRef).toHaveBeenCalledWith('Doist')
        expect(refsMocks.resolveUserRefs).toHaveBeenCalledWith('id:10,id:20', 9)
        expect(client.channels.createChannel).toHaveBeenCalledWith({
            workspaceId: 9,
            name: 'Leadership',
            description: 'Private leadership discussions',
            userIds: [10, 20],
            public: false,
        })
        expect(consoleSpy.mock.calls[0][0]).toContain('Leadership')
    })

    it('outputs created channel JSON', async () => {
        const createdChannel = createChannel(300, 'Product', {
            id: 'CH300',
            url: 'https://comms.todoist.com/a/1/ch/CH300',
        })
        const client = createClient({ createdChannel })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['create', 'Product', '--json'])

        expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({
            id: 'CH300',
            name: 'Product',
            workspaceId: 1,
            public: true,
            archived: false,
            url: 'https://comms.todoist.com/a/1/ch/CH300',
        })
    })

    it('does not create in dry-run mode', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['create', 'Engineering', '--dry-run'])

        expect(client.channels.createChannel).not.toHaveBeenCalled()
        expect(consoleSpy.mock.calls[0][0]).toContain('[dry-run] Would create channel')
    })

    it('rejects invalid create options', async () => {
        await expect(runChannelCommand(['create', '   '])).rejects.toHaveProperty(
            'code',
            'INVALID_NAME',
        )
        await expect(runChannelCommand(['create', 'Q3'])).rejects.toHaveProperty(
            'code',
            'INVALID_NAME',
        )

        vi.clearAllMocks()
        await expect(
            runChannelCommand([
                'create',
                'Engineering',
                '--public',
                '--private',
                '--users',
                'id:1',
            ]),
        ).rejects.toHaveProperty('code', 'CONFLICTING_OPTIONS')
        expect(apiMocks.getCurrentWorkspaceId).not.toHaveBeenCalled()
        expect(refsMocks.resolveUserRefs).not.toHaveBeenCalled()
    })
})

describe('channels update', () => {
    const engineering = createChannel(10, 'Engineering', {
        id: 'CH10',
        description: 'Engineering discussion',
        url: 'https://comms.todoist.com/a/1/ch/CH10',
    })

    beforeEach(() => {
        vi.clearAllMocks()
        refsMocks.parseRef.mockImplementation((ref: string) => ({ type: 'name', name: ref }))
        refsMocks.getDirectChannelId.mockReturnValue(null)
        refsMocks.resolveChannelRef.mockResolvedValue(engineering)
    })

    it('renames direct refs via --name without resolving workspace or channel', async () => {
        refsMocks.getDirectChannelId.mockReturnValue('CH10')
        const updatedChannel = { ...engineering, name: 'Platform Engineering' }
        const client = createClient({ updatedChannel })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['update', 'id:CH10', '--name', 'Platform Engineering', '--json'])

        expect(apiMocks.getCurrentWorkspaceId).not.toHaveBeenCalled()
        expect(refsMocks.resolveChannelRef).not.toHaveBeenCalled()
        expect(client.channels.updateChannel).toHaveBeenCalledWith({
            id: 'CH10',
            name: 'Platform Engineering',
        })
        expect(JSON.parse(consoleSpy.mock.calls[0][0])).toMatchObject({
            id: 'CH10',
            name: 'Platform Engineering',
            workspaceId: 1,
            public: true,
            archived: false,
        })
    })

    it('updates direct refs by fetching the current name only when needed', async () => {
        refsMocks.getDirectChannelId.mockReturnValue('CH10')
        const updatedChannel = { ...engineering, description: 'Team discussion' }
        const client = createClient({ updatedChannel })
        client.channels.getChannel = vi.fn().mockResolvedValue(engineering)
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['update', 'id:CH10', '--description', 'Team discussion', '--json'])

        expect(refsMocks.resolveChannelRef).not.toHaveBeenCalled()
        expect(client.channels.getChannel).toHaveBeenCalledWith('CH10')
        expect(client.channels.updateChannel).toHaveBeenCalledWith({
            id: 'CH10',
            name: 'Engineering',
            description: 'Team discussion',
        })
        expect(JSON.parse(consoleSpy.mock.calls[0][0])).toMatchObject({
            id: 'CH10',
            description: 'Team discussion',
        })
    })

    it('updates metadata in a selected workspace while keeping the current name', async () => {
        refsMocks.resolveWorkspaceRef.mockResolvedValue({ id: 9, name: 'Doist' })
        const selectedWorkspaceChannel = { ...engineering, workspaceId: 9 }
        refsMocks.resolveChannelRef.mockResolvedValue(selectedWorkspaceChannel)
        const updatedChannel = { ...selectedWorkspaceChannel, description: null, public: false }
        const client = createClient({ updatedChannel })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand([
            'update',
            'Engineering',
            '--workspace',
            'Doist',
            '--clear-description',
            '--private',
        ])

        expect(refsMocks.resolveWorkspaceRef).toHaveBeenCalledWith('Doist')
        expect(refsMocks.resolveChannelRef).toHaveBeenCalledWith('Engineering', 9)
        expect(client.channels.updateChannel).toHaveBeenCalledWith({
            id: 'CH10',
            name: 'Engineering',
            description: null,
            public: false,
        })
        expect(consoleSpy.mock.calls[0][0]).toContain('Engineering')
    })

    it('does not update or fetch direct refs in dry-run mode', async () => {
        refsMocks.getDirectChannelId.mockReturnValue('CH10')
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand([
            'update',
            'id:CH10',
            '--description',
            'New description',
            '--dry-run',
        ])

        expect(client.channels.getChannel).not.toHaveBeenCalled()
        expect(client.channels.updateChannel).not.toHaveBeenCalled()
        expect(consoleSpy.mock.calls[0][0]).toContain('[dry-run] Would update channel')
    })

    it('rejects invalid update options', async () => {
        await expect(runChannelCommand(['update', 'Engineering'])).rejects.toHaveProperty(
            'code',
            'INVALID_VALUE',
        )

        await expect(
            runChannelCommand(['update', 'Engineering', 'New Name', '--name', 'Other Name']),
        ).rejects.toHaveProperty('code', 'CONFLICTING_OPTIONS')

        await expect(
            runChannelCommand([
                'update',
                'Engineering',
                '--description',
                'Text',
                '--clear-description',
            ]),
        ).rejects.toHaveProperty('code', 'CONFLICTING_OPTIONS')
    })
})

describe('channels delete', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        refsMocks.getDirectChannelId.mockReturnValue(null)
        refsMocks.resolveChannelRef.mockResolvedValue(
            createChannel(500, 'Engineering', { id: 'CH500' }),
        )
    })

    it('refuses to delete without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['delete', 'Engineering'])

        expect(client.channels.deleteChannel).not.toHaveBeenCalled()
        expect(consoleSpy.mock.calls.some((c) => String(c[0]).includes('Use --yes'))).toBe(true)
    })

    it('deletes when --yes is passed', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['delete', 'Engineering', '--yes'])

        expect(refsMocks.resolveChannelRef).toHaveBeenCalledWith('Engineering', 1)
        expect(client.channels.deleteChannel).toHaveBeenCalledWith('CH500')
        expect(consoleSpy.mock.calls[0][0]).toContain('Engineering')
    })

    it('does not delete on --dry-run', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['delete', 'Engineering', '--dry-run'])

        expect(client.channels.deleteChannel).not.toHaveBeenCalled()
        const text = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
        expect(text).toContain('delete channel')
    })

    it('does not delete when --yes is combined with --dry-run', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['delete', 'Engineering', '--yes', '--dry-run'])

        expect(client.channels.deleteChannel).not.toHaveBeenCalled()
        const text = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
        expect(text).toContain('delete channel')
    })

    it('errors in --json mode without --yes before doing any lookups', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        await expect(runChannelCommand(['delete', 'Engineering', '--json'])).rejects.toHaveProperty(
            'code',
            'MISSING_YES_FLAG',
        )
        expect(client.channels.deleteChannel).not.toHaveBeenCalled()
        expect(refsMocks.resolveChannelRef).not.toHaveBeenCalled()
        expect(apiMocks.getCurrentWorkspaceId).not.toHaveBeenCalled()
    })

    it('outputs JSON result with --yes --json', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['delete', 'Engineering', '--yes', '--json'])

        expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({ id: 'CH500', deleted: true })
    })
})

describe('channels archive', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        refsMocks.getDirectChannelId.mockReturnValue(null)
        refsMocks.resolveChannelRef.mockResolvedValue(
            createChannel(500, 'Engineering', { id: 'CH500' }),
        )
    })

    it('archives the resolved channel', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['archive', 'Engineering'])

        expect(refsMocks.resolveChannelRef).toHaveBeenCalledWith('Engineering', 1)
        expect(client.channels.archiveChannel).toHaveBeenCalledWith('CH500')
        expect(consoleSpy.mock.calls[0][0]).toContain('archived')
    })

    it('does not call the API on --dry-run', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['archive', 'Engineering', '--dry-run'])

        expect(client.channels.archiveChannel).not.toHaveBeenCalled()
        const text = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
        expect(text).toContain('archive channel')
    })

    it('outputs JSON with --json', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['archive', 'Engineering', '--json'])

        expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({ id: 'CH500', archived: true })
    })

    it('skips the API call when channel is already archived', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(
            createChannel(500, 'Engineering', { id: 'CH500', archived: true }),
        )
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['archive', 'Engineering'])

        expect(client.channels.archiveChannel).not.toHaveBeenCalled()
        expect(consoleSpy.mock.calls[0][0]).toContain('already in target state')
    })
})

describe('channels unarchive', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        refsMocks.getDirectChannelId.mockReturnValue(null)
        refsMocks.resolveChannelRef.mockResolvedValue(
            createChannel(500, 'Engineering', { id: 'CH500', archived: true }),
        )
    })

    it('unarchives the resolved channel', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['unarchive', 'id:CH500'])

        expect(refsMocks.resolveChannelRef).toHaveBeenCalledWith('id:CH500', 1)
        expect(client.channels.unarchiveChannel).toHaveBeenCalledWith('CH500')
        expect(consoleSpy.mock.calls[0][0]).toContain('unarchived')
    })

    it('does not call the API on --dry-run', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['unarchive', 'id:CH500', '--dry-run'])

        expect(client.channels.unarchiveChannel).not.toHaveBeenCalled()
        const text = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
        expect(text).toContain('unarchive channel')
    })

    it('outputs JSON with --json', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await runChannelCommand(['unarchive', 'id:CH500', '--json'])

        expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({ id: 'CH500', archived: false })
    })
})

const lifecycleCommands = [
    { name: 'delete', extraArgs: ['--yes'], method: 'deleteChannel', archived: false },
    { name: 'archive', extraArgs: [], method: 'archiveChannel', archived: false },
    { name: 'unarchive', extraArgs: [], method: 'unarchiveChannel', archived: true },
] as const

describe('channels lifecycle --workspace', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        refsMocks.getDirectChannelId.mockReturnValue(null)
        refsMocks.resolveWorkspaceRef.mockResolvedValue({ id: 42, name: 'Other' })
    })

    for (const cmd of lifecycleCommands) {
        it(`${cmd.name} resolves --workspace and passes its ID to resolveChannelRef`, async () => {
            refsMocks.resolveChannelRef.mockResolvedValue(
                createChannel(500, 'Engineering', { id: 'CH500', archived: cmd.archived }),
            )
            const client = createClient()
            apiMocks.getCommsClient.mockResolvedValue(client)
            captureConsole('log')

            await runChannelCommand([
                cmd.name,
                'Engineering',
                '--workspace',
                'Other',
                ...cmd.extraArgs,
            ])

            expect(refsMocks.resolveWorkspaceRef).toHaveBeenCalledWith('Other')
            expect(refsMocks.resolveChannelRef).toHaveBeenCalledWith('Engineering', 42)
            expect(client.channels[cmd.method]).toHaveBeenCalledWith('CH500')
            expect(apiMocks.getCurrentWorkspaceId).not.toHaveBeenCalled()
        })
    }
})

describe('channels lifecycle direct refs', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        refsMocks.getDirectChannelId.mockReturnValue('CH500')
    })

    for (const cmd of lifecycleCommands) {
        it(`${cmd.name} fetches a direct ref by ID without resolving a workspace`, async () => {
            const client = createClient()
            client.channels.getChannel.mockResolvedValue(
                createChannel(500, 'Engineering', { id: 'CH500', archived: cmd.archived }),
            )
            apiMocks.getCommsClient.mockResolvedValue(client)
            captureConsole('log')

            await runChannelCommand([cmd.name, 'id:CH500', ...cmd.extraArgs])

            expect(client.channels.getChannel).toHaveBeenCalledWith('CH500')
            expect(refsMocks.resolveChannelRef).not.toHaveBeenCalled()
            expect(refsMocks.resolveWorkspaceRef).not.toHaveBeenCalled()
            expect(apiMocks.getCurrentWorkspaceId).not.toHaveBeenCalled()
            expect(client.channels[cmd.method]).toHaveBeenCalledWith('CH500')
        })
    }
})

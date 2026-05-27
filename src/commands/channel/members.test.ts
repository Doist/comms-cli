import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCurrentWorkspaceId: vi.fn().mockResolvedValue(1),
    getWorkspaceGroups: vi.fn(),
    getWorkspaceUsers: vi.fn(),
    getCommsClient: vi.fn(),
    getSessionUser: vi.fn(),
    addUsersToChannel: vi.fn(),
    removeUsersFromChannel: vi.fn(),
}))

vi.mock('../../lib/api.js', () => apiMocks)

const refsMocks = vi.hoisted(() => ({
    resolveChannelRef: vi.fn(),
    resolveChannelMemberRefs: vi.fn(),
}))

vi.mock('../../lib/refs.js', () => refsMocks)

vi.mock('chalk')

import { registerChannelCommand } from './index.js'

const createProgram = () => createTestProgram(registerChannelCommand)

function createChannel(userIds: number[], overrides: Record<string, unknown> = {}) {
    return {
        id: 'CH1',
        name: 'General',
        public: true,
        workspaceId: 1,
        archived: false,
        creator: 1,
        created: new Date('2026-01-01T00:00:00Z'),
        version: 1,
        userIds,
        ...overrides,
    }
}

const sampleGroups = [
    { id: 'GR100', name: 'Frontend', workspaceId: 1, userIds: [1, 2, 3], version: 1 },
    { id: 'GR200', name: 'Backend', workspaceId: 1, userIds: [4, 5], version: 1 },
]

const workspaceUsers = [
    { id: 1, fullName: 'Alice', email: 'a@d.com' },
    { id: 2, fullName: 'Bob', email: 'b@d.com' },
    { id: 3, fullName: 'Carol', email: 'c@d.com' },
    { id: 4, fullName: 'Dave', email: 'd@d.com' },
    { id: 5, fullName: 'Eve', email: 'e@d.com' },
]

function createClient() {
    return {
        workspaceUsers: {
            getUserById: vi.fn(async ({ userId }: { workspaceId: number; userId: number }) => {
                const user = workspaceUsers.find((u) => u.id === userId)
                if (!user) throw new Error(`User ${userId} not found`)
                return user
            }),
        },
        channels: { getChannel: vi.fn() },
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
    apiMocks.getWorkspaceGroups.mockResolvedValue(sampleGroups)
    apiMocks.getCommsClient.mockResolvedValue(createClient())
    apiMocks.getSessionUser.mockResolvedValue({ id: 1, fullName: 'Alice' })
})

describe('tdc channel members list (default)', () => {
    it('lists members with names/emails and groups fully in channel', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2, 3]))
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'members', 'General'])

        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('Alice')
        expect(output).toContain('a@d.com')
        expect(output).toContain('3 members')
        expect(output).toContain('Groups fully in channel (1)')
        expect(output).toContain('Frontend')
        expect(output).not.toContain('Backend')
    })

    it('emits slim JSON with members and groupsFullyInChannel', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2, 3]))
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'members', 'General', '--json'])

        const payload = JSON.parse(consoleSpy.mock.calls[0][0] as string)
        expect(payload.id).toBe('CH1')
        expect(payload.members).toHaveLength(3)
        expect(payload.members[0]).toEqual({ id: 1, name: 'Alice', email: 'a@d.com' })
        expect(payload.groupsFullyInChannel).toEqual([
            { id: 'GR100', name: 'Frontend', userIds: [1, 2, 3] },
        ])
    })

    it('falls back to user:<id> for unknown members', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([99]))
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'members', 'General'])

        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('user:99')
    })
})

describe('tdc channel members add', () => {
    it('adds only users not already in the channel', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [1, 3], expandedFrom: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'add',
            'General',
            'carol',
            'alice',
        ])

        expect(apiMocks.addUsersToChannel).toHaveBeenCalledWith('CH1', [3])
        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('Added 1 user to "General" (now 3 members)')
        expect(output).toContain('Already members: 1')
    })

    it('expands group: refs and logs the expansion', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({
            userIds: [1, 2, 3],
            expandedFrom: [{ groupId: 'GR100', groupName: 'Frontend', userIds: [1, 2, 3] }],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'add',
            'General',
            'group:Frontend',
        ])

        expect(apiMocks.addUsersToChannel).toHaveBeenCalledWith('CH1', [2, 3])
        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('Expanded group "Frontend"')
    })

    it('does not mutate on --dry-run', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [3], expandedFrom: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'add',
            'General',
            'carol',
            '--dry-run',
        ])

        expect(apiMocks.addUsersToChannel).not.toHaveBeenCalled()
        expect(consoleSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('[dry-run]')
    })

    it('emits slim JSON result', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [1, 3], expandedFrom: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'add',
            'General',
            'alice',
            'carol',
            '--json',
        ])

        const payload = JSON.parse(consoleSpy.mock.calls[0][0] as string)
        expect(payload).toEqual({
            id: 'CH1',
            memberCount: 3,
            added: [3],
            alreadyMembers: [1],
        })
    })
})

describe('tdc channel members remove', () => {
    it('removes only users currently in the channel', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2, 3]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [3, 9], expandedFrom: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'remove',
            'General',
            'carol',
            'id:9',
        ])

        expect(apiMocks.removeUsersFromChannel).toHaveBeenCalledWith('CH1', [3])
        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('Removed 1 user from "General" (now 2 members)')
        expect(output).toContain('Not members: 9')
    })
})

describe('tdc channel members set', () => {
    it('refuses to remove the acting user without --include-self', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [2], expandedFrom: [] })
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'channel', 'members', 'set', 'General', 'bob']),
        ).rejects.toThrow(/would remove you/)
        expect(apiMocks.removeUsersFromChannel).not.toHaveBeenCalled()
    })

    it('is dry-run by default (no --apply)', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [1, 3], expandedFrom: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'set',
            'General',
            'alice',
            'carol',
        ])

        expect(apiMocks.addUsersToChannel).not.toHaveBeenCalled()
        expect(apiMocks.removeUsersFromChannel).not.toHaveBeenCalled()
        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('[dry-run]')
        expect(output).toContain('dry-run by default')
    })

    it('applies add + remove with --apply', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [1, 3], expandedFrom: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'set',
            'General',
            'alice',
            'carol',
            '--apply',
        ])

        expect(apiMocks.addUsersToChannel).toHaveBeenCalledWith('CH1', [3])
        expect(apiMocks.removeUsersFromChannel).toHaveBeenCalledWith('CH1', [2])
        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('Set "General": +1 / -1 (now 2 members)')
    })

    it('emits JSON result on --apply --json with both directions changing', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [1, 3], expandedFrom: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'set',
            'General',
            'alice',
            'carol',
            '--apply',
            '--json',
        ])

        const payload = JSON.parse(consoleSpy.mock.calls[0][0] as string)
        expect(payload).toEqual({ id: 'CH1', memberCount: 2, added: [3], removed: [2] })
    })

    it('emits JSON (not text) on dry-run --json without --apply', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [1, 3], expandedFrom: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'set',
            'General',
            'alice',
            'carol',
            '--json',
        ])

        expect(apiMocks.addUsersToChannel).not.toHaveBeenCalled()
        const payload = JSON.parse(consoleSpy.mock.calls[0][0] as string)
        expect(payload).toEqual({
            id: 'CH1',
            dryRun: true,
            memberCount: 2,
            added: [3],
            removed: [2],
        })
    })

    it('removes the acting user when --include-self is passed', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(createChannel([1, 2]))
        refsMocks.resolveChannelMemberRefs.mockResolvedValue({ userIds: [2], expandedFrom: [] })
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'members',
            'set',
            'General',
            'bob',
            '--apply',
            '--include-self',
        ])

        expect(apiMocks.removeUsersFromChannel).toHaveBeenCalledWith('CH1', [1])
    })
})

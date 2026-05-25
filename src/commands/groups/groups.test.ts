import {
    captureConsole,
    createTestProgram,
    describeEmptyMachineOutput,
} from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCurrentWorkspaceId: vi.fn().mockResolvedValue(1),
    getWorkspaceGroups: vi.fn(),
    getWorkspaceUsers: vi.fn(),
    getCommsClient: vi.fn(),
    getGroup: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    addUsersToGroup: vi.fn(),
    removeUsersFromGroup: vi.fn(),
}))

vi.mock('../../lib/api.js', () => apiMocks)

const refsMocks = vi.hoisted(() => ({
    resolveWorkspaceRef: vi.fn(),
    resolveUserRefs: vi.fn(),
    resolveGroupRef: vi.fn(),
}))

vi.mock('../../lib/refs.js', () => refsMocks)

vi.mock('chalk')

import { registerGroupsCommand } from './index.js'

const createProgram = () => createTestProgram(registerGroupsCommand)

const sampleGroups = [
    {
        id: 'GR100',
        name: 'Frontend',
        description: 'Frontend team',
        workspaceId: 1,
        userIds: [1, 2, 3],
        version: 1,
    },
    {
        id: 'GR200',
        name: 'Backend',
        description: null,
        workspaceId: 1,
        userIds: [4, 5],
        version: 1,
    },
    {
        id: 'GR300',
        name: 'Full Stack',
        description: 'Cross-team',
        workspaceId: 1,
        userIds: [1, 4],
        version: 1,
    },
]

const frontend = sampleGroups[0]

const workspaceUsers = [
    { id: 1, fullName: 'Alice', email: 'a@d.com' },
    { id: 2, fullName: 'Bob', email: 'b@d.com' },
    { id: 3, fullName: 'Carol', email: 'c@d.com' },
    { id: 4, fullName: 'Dave', email: 'd@d.com' },
    { id: 5, fullName: 'Eve', email: 'e@d.com' },
]

beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
    apiMocks.getWorkspaceGroups.mockResolvedValue(sampleGroups)
    apiMocks.getWorkspaceUsers.mockResolvedValue(workspaceUsers)
})

describeEmptyMachineOutput('tdc groups list empty output', {
    setup: () => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        apiMocks.getWorkspaceGroups.mockResolvedValue([])
    },
    run: async (extraArgs) => {
        const program = createProgram()
        await program.parseAsync(['node', 'tdc', 'groups', ...extraArgs])
    },
    humanMessage: 'No groups found.',
})

describe('tdc groups list (default)', () => {
    it('lists all groups', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups'])

        expect(consoleSpy).toHaveBeenCalledTimes(3)
        expect(consoleSpy.mock.calls[0][0]).toContain('Frontend')
    })

    it('outputs JSON', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', '--json'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output).toHaveLength(3)
        expect(output[0].id).toBe('GR100')
    })

    it('still works with explicit list subcommand', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'list'])

        expect(consoleSpy).toHaveBeenCalledTimes(3)
    })

    it('filters groups with --search', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', '--search', 'front'])

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        expect(consoleSpy.mock.calls[0][0]).toContain('Frontend')
    })

    it('shows empty message when no groups match', async () => {
        apiMocks.getWorkspaceGroups.mockResolvedValue([])
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups'])

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        expect(consoleSpy.mock.calls[0][0]).toContain('No groups')
    })

    it('outputs NDJSON', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', '--ndjson'])

        // NDJSON emits all lines via formatNdjson in a single console.log call
        expect(consoleSpy).toHaveBeenCalledTimes(1)
        const lines = consoleSpy.mock.calls[0][0].split('\n').filter(Boolean)
        expect(lines).toHaveLength(3)
        expect(JSON.parse(lines[0]).id).toBe('GR100')
    })

    it('includes all fields with --json --full', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', '--json', '--full'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output[0]).toHaveProperty('description')
        expect(output[0]).toHaveProperty('version')
    })

    it('accepts [workspace-ref] positional argument', async () => {
        refsMocks.resolveWorkspaceRef.mockResolvedValue({ id: 1, name: 'Test' })
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'list', '1'])

        expect(refsMocks.resolveWorkspaceRef).toHaveBeenCalledWith('1')
        expect(consoleSpy).toHaveBeenCalled()
    })
})

describe('tdc groups view', () => {
    const mockGetUserById = vi.fn()

    beforeEach(() => {
        refsMocks.resolveGroupRef.mockResolvedValue(frontend)
        mockGetUserById.mockImplementation(
            async ({ userId }: { workspaceId: number; userId: number }) => {
                const user = workspaceUsers.find((u) => u.id === userId)
                if (!user) throw new Error(`User ${userId} not found`)
                return user
            },
        )
        apiMocks.getCommsClient.mockResolvedValue({
            workspaceUsers: { getUserById: mockGetUserById },
        })
    })

    it('resolves group ref and fetches each member individually', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'view', 'Frontend'])

        expect(refsMocks.resolveGroupRef).toHaveBeenCalledWith('Frontend', 1)
        // Per-member fetch, not a workspace-wide load
        expect(mockGetUserById).toHaveBeenCalledTimes(frontend.userIds.length)
        for (const userId of frontend.userIds) {
            expect(mockGetUserById).toHaveBeenCalledWith({ workspaceId: 1, userId })
        }
        expect(apiMocks.getWorkspaceUsers).not.toHaveBeenCalled()
        const text = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(text).toContain('Alice')
        expect(text).toContain('Bob')
        expect(text).toContain('Carol')
    })

    it('outputs JSON with enriched members (default shape)', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'view', 'id:GR100', '--json'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.id).toBe('GR100')
        expect(output.name).toBe('Frontend')
        expect(output.members).toHaveLength(3)
        expect(output.members[0]).toMatchObject({ id: 1, name: 'Alice', email: 'a@d.com' })
        // Default shape should not include raw SDK fields like description, version
        expect(output).not.toHaveProperty('description')
        expect(output).not.toHaveProperty('version')
    })

    it('renders user:N for members whose lookup fails', async () => {
        mockGetUserById.mockImplementationOnce(async () => {
            throw new Error('User not found')
        })
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'view', 'Frontend', '--json'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        const missing = output.members.find((m: { id: number }) => m.id === frontend.userIds[0])
        expect(missing).toMatchObject({ id: 1, name: null, email: null })
    })

    it('outputs JSON with all fields when --full', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'view', 'id:GR100', '--json', '--full'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.id).toBe('GR100')
        expect(output.members).toHaveLength(3)
        // Full shape includes everything
        expect(output).toHaveProperty('description')
    })
})

describe('tdc groups create', () => {
    beforeEach(() => {
        apiMocks.createGroup.mockResolvedValue({ ...frontend, id: 'GR999', name: 'Design' })
    })

    it('creates a group without users', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'create', 'Design'])

        expect(apiMocks.createGroup).toHaveBeenCalledWith({
            workspaceId: 1,
            name: 'Design',
            userIds: undefined,
        })
        expect(consoleSpy.mock.calls[0][0]).toContain('Design')
    })

    it('resolves --users and passes ids to createGroup', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([10, 20])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'groups',
            'create',
            'Design',
            '--users',
            'a@d.com,b@d.com',
        ])

        expect(refsMocks.resolveUserRefs).toHaveBeenCalledWith('a@d.com,b@d.com', 1)
        expect(apiMocks.createGroup).toHaveBeenCalledWith({
            workspaceId: 1,
            name: 'Design',
            userIds: [10, 20],
        })
    })

    it('rejects empty name', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync(['node', 'tdc', 'groups', 'create', '   ']),
        ).rejects.toMatchObject({ code: 'INVALID_NAME' })
    })
})

describe('tdc groups rename', () => {
    beforeEach(() => {
        refsMocks.resolveGroupRef.mockResolvedValue(frontend)
        apiMocks.updateGroup.mockResolvedValue({ ...frontend, name: 'FE Team' })
    })

    it('renames an existing group', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'rename', 'Frontend', 'FE Team'])

        expect(apiMocks.updateGroup).toHaveBeenCalledWith({
            id: 'GR100',
            workspaceId: 1,
            name: 'FE Team',
        })
        expect(consoleSpy.mock.calls[0][0]).toContain('FE Team')
    })
})

describe('tdc groups delete', () => {
    beforeEach(() => {
        refsMocks.resolveGroupRef.mockResolvedValue(frontend)
    })

    it('refuses to delete without --yes', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'delete', 'Frontend'])

        expect(apiMocks.deleteGroup).not.toHaveBeenCalled()
        expect(consoleSpy.mock.calls.some((c) => String(c[0]).includes('Use --yes'))).toBe(true)
    })

    it('deletes when --yes is passed', async () => {
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'delete', 'Frontend', '--yes'])

        expect(apiMocks.deleteGroup).toHaveBeenCalledWith('GR100', 1)
    })

    it('errors in --json mode without --yes', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync(['node', 'tdc', 'groups', 'delete', 'Frontend', '--json']),
        ).rejects.toMatchObject({ code: 'MISSING_YES_FLAG' })
    })
})

describe('tdc groups add-user', () => {
    beforeEach(() => {
        refsMocks.resolveGroupRef.mockResolvedValue({ ...frontend, userIds: [1, 2] })
    })

    it('joins variadic refs and resolves them', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([3, 4])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'groups',
            'add-user',
            'Frontend',
            'carol@d.com',
            'dave@d.com',
        ])

        expect(refsMocks.resolveUserRefs).toHaveBeenCalledWith('carol@d.com,dave@d.com', 1)
        expect(apiMocks.addUsersToGroup).toHaveBeenCalledWith('GR100', 1, [3, 4])
    })

    it('mixes comma- and space-separated refs', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([3, 4, 5])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'groups',
            'add-user',
            'id:GR100',
            'a@d.com,b@d.com',
            'c@d.com',
        ])

        expect(refsMocks.resolveUserRefs).toHaveBeenCalledWith('a@d.com,b@d.com,c@d.com', 1)
    })

    it('skips users already in the group', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([1, 3])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'add-user', 'Frontend', 'id:1,id:3'])

        expect(apiMocks.addUsersToGroup).toHaveBeenCalledWith('GR100', 1, [3])
    })

    it('makes no API call when all users are already members', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([1, 2])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'groups', 'add-user', 'Frontend', 'id:1,id:2'])

        expect(apiMocks.addUsersToGroup).not.toHaveBeenCalled()
    })

    it('errors when no user refs given', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync(['node', 'tdc', 'groups', 'add-user', 'Frontend']),
        ).rejects.toMatchObject({ code: 'MISSING_USERS' })
    })

    it('deduplicates resolved user IDs', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([3, 3, 4])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'groups',
            'add-user',
            'Frontend',
            'id:3,id:3',
            'id:4',
        ])

        // Should deduplicate before calling the API
        expect(apiMocks.addUsersToGroup).toHaveBeenCalledWith('GR100', 1, [3, 4])
    })
})

describe('tdc groups remove-user', () => {
    beforeEach(() => {
        refsMocks.resolveGroupRef.mockResolvedValue({ ...frontend, userIds: [1, 2, 3] })
    })

    it('only removes users that are members', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([2, 3, 99])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'groups',
            'remove-user',
            'Frontend',
            'id:2,id:3,id:99',
        ])

        expect(apiMocks.removeUsersFromGroup).toHaveBeenCalledWith('GR100', 1, [2, 3])
    })

    it('makes no API call when none of the users are members', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([99, 100])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'groups',
            'remove-user',
            'Frontend',
            'id:99,id:100',
        ])

        expect(apiMocks.removeUsersFromGroup).not.toHaveBeenCalled()
    })

    it('errors when no user refs given', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync(['node', 'tdc', 'groups', 'remove-user', 'Frontend']),
        ).rejects.toMatchObject({ code: 'MISSING_USERS' })
    })

    it('deduplicates resolved user IDs', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([2, 2, 3])
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'groups',
            'remove-user',
            'Frontend',
            'id:2,id:2',
            'id:3',
        ])

        // Should deduplicate before calling the API
        expect(apiMocks.removeUsersFromGroup).toHaveBeenCalledWith('GR100', 1, [2, 3])
    })
})

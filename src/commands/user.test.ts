import {
    captureConsole,
    createTestProgram,
    describeEmptyMachineOutput,
} from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    getCurrentWorkspaceId: vi.fn().mockResolvedValue(1),
    getSessionUser: vi.fn(),
    getWorkspaceUsers: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
    getCommsClient: apiMocks.getCommsClient,
    getCurrentWorkspaceId: apiMocks.getCurrentWorkspaceId,
    getSessionUser: apiMocks.getSessionUser,
    getWorkspaceUsers: apiMocks.getWorkspaceUsers,
}))

vi.mock('../lib/refs.js', () => ({
    resolveWorkspaceRef: vi.fn(),
}))

vi.mock('chalk')

import { registerUserCommand } from './user.js'

const createProgram = () => createTestProgram(registerUserCommand)

describe('users --workspace conflict', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('errors when both positional and --workspace are provided', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'users', 'Doist', '--workspace', 'Other']),
        ).rejects.toThrow('Cannot specify workspace both as argument and --workspace flag')
    })
})

describeEmptyMachineOutput('tdc users empty output', {
    setup: () => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        apiMocks.getWorkspaceUsers.mockResolvedValue([])
    },
    run: async (extraArgs) => {
        const program = createProgram()
        await program.parseAsync(['node', 'tdc', 'users', ...extraArgs])
    },
    humanMessage: 'No users found.',
    idsOnly: true,
})

describe('tdc users --include-removed', () => {
    const active = {
        id: 1,
        fullName: 'Active',
        email: 'a@x',
        userType: 'USER',
        removed: false,
    }
    const removed = {
        id: 2,
        fullName: 'Ghost',
        email: 'ghost@x',
        userType: 'GUEST',
        removed: true,
    }

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
    })

    it('passes includeRemoved: undefined by default so the SDK applies its default filter', async () => {
        apiMocks.getWorkspaceUsers.mockResolvedValueOnce([active])
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'users'])

        expect(apiMocks.getWorkspaceUsers).toHaveBeenCalledWith(1, { includeRemoved: undefined })
        expect(consoleSpy.mock.calls.flat().join('\n')).not.toMatch(/\[removed\]/)
    })

    it('passes includeRemoved: true and annotates removed users in text output', async () => {
        apiMocks.getWorkspaceUsers.mockResolvedValueOnce([active, removed])
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'users', '--include-removed'])

        expect(apiMocks.getWorkspaceUsers).toHaveBeenCalledWith(1, { includeRemoved: true })
        const lines = consoleSpy.mock.calls.flat().join('\n')
        expect(lines).toMatch(/id:2.*Ghost.*\[removed\]/)
        expect(lines).not.toMatch(/id:1.*Active.*\[removed\]/)
    })

    it('outputs one stable user ID per line with --ids-only', async () => {
        apiMocks.getWorkspaceUsers.mockResolvedValueOnce([active, removed])
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'users', '--ids-only'])

        expect(consoleSpy).toHaveBeenCalledWith('1\n2')
    })

    it('surfaces removed in curated --json output without --full', async () => {
        apiMocks.getWorkspaceUsers.mockResolvedValueOnce([active, removed])
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'users', '--include-removed', '--json'])

        const parsed = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(parsed).toHaveLength(2)
        expect(parsed[0]).toMatchObject({ id: 1, removed: false })
        expect(parsed[1]).toMatchObject({ id: 2, removed: true })
        // Curated, not --full: shortName must not leak in.
        expect(parsed[0]).not.toHaveProperty('shortName')
    })
})

describe('user --json', () => {
    const sampleUser = {
        id: 42,
        fullName: 'Jane Smith',
        email: 'jane@example.com',
        timezone: 'America/New_York',
        userType: 'USER',
        lang: 'en',
        shortName: 'Jane',
    }

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getSessionUser.mockResolvedValue(sampleUser)
        apiMocks.getCommsClient.mockResolvedValue({
            workspaces: {
                getDefaultWorkspace: vi.fn().mockResolvedValue({ id: 1, name: 'Doist' }),
            },
        })
    })

    it('outputs essential user fields as JSON', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'user', '--json'])

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe(42)
        expect(jsonOutput.fullName).toBe('Jane Smith')
        expect(jsonOutput.email).toBe('jane@example.com')
        expect(jsonOutput.timezone).toBe('America/New_York')
        expect(jsonOutput).not.toHaveProperty('lang')
        expect(jsonOutput).not.toHaveProperty('shortName')
    })

    it('outputs full user fields with --full', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'user', '--json', '--full'])

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toHaveProperty('lang', 'en')
        expect(jsonOutput).toHaveProperty('shortName', 'Jane')
        expect(jsonOutput).toHaveProperty('defaultWorkspaceId', 1)
    })
})

import { describeEmptyMachineOutput } from '@doist/cli-core/testing'
import { Command } from 'commander'
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

function createProgram() {
    const program = new Command()
    program.exitOverride()
    registerUserCommand(program)
    return program
}

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
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'user', '--json'])

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe(42)
        expect(jsonOutput.fullName).toBe('Jane Smith')
        expect(jsonOutput.email).toBe('jane@example.com')
        expect(jsonOutput.timezone).toBe('America/New_York')
        expect(jsonOutput).not.toHaveProperty('lang')
        expect(jsonOutput).not.toHaveProperty('shortName')

        consoleSpy.mockRestore()
    })

    it('outputs full user fields with --full', async () => {
        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'user', '--json', '--full'])

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toHaveProperty('lang', 'en')
        expect(jsonOutput).toHaveProperty('shortName', 'Jane')
        expect(jsonOutput).toHaveProperty('defaultWorkspaceId', 1)

        consoleSpy.mockRestore()
    })
})

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

    it('never prints session credentials with --full', async () => {
        apiMocks.getSessionUser.mockResolvedValue({
            ...sampleUser,
            token: 'SECRET-SESSION-TOKEN',
            cometChannel: 'SECRET-COMET-CHANNEL',
        })
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'user', '--json', '--full'])

        const stdout = consoleSpy.mock.calls.flat().join('\n')
        expect(stdout).not.toContain('SECRET-')
        expect(JSON.parse(stdout)).not.toHaveProperty('token')
        expect(JSON.parse(stdout)).toHaveProperty('shortName', 'Jane')
    })
})

describe('users --full', () => {
    const leaky = {
        id: 1,
        fullName: 'Active',
        email: 'a@x',
        userType: 'USER',
        removed: false,
        lang: 'en',
        token: 'SECRET-SESSION-TOKEN',
        cometChannel: 'SECRET-COMET-CHANNEL',
    }

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        apiMocks.getWorkspaceUsers.mockResolvedValue([leaky])
    })

    // Full-only field (`lang`) proves --full was honoured, so this cannot pass on curated output.
    it.each(['--json', '--ndjson'])('omits session credentials with %s --full', async (flag) => {
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'users', flag, '--full'])

        const out: string = consoleSpy.mock.calls[0][0]
        const parsed = JSON.parse(flag === '--ndjson' ? out.split('\n')[0] : out)
        const user = Array.isArray(parsed) ? parsed[0] : parsed
        expect(user).toHaveProperty('lang', 'en')
        expect(user).not.toHaveProperty('token')
        expect(user).not.toHaveProperty('cometChannel')
    })
})

describe('user status line', () => {
    const baseUser = {
        id: 42,
        fullName: 'Jane Smith',
        email: 'jane@example.com',
        timezone: 'America/New_York',
    }

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCommsClient.mockResolvedValue({
            workspaces: { getDefaultWorkspace: vi.fn().mockResolvedValue(null) },
        })
    })

    it('prints the status when one is set', async () => {
        apiMocks.getSessionUser.mockResolvedValue({
            ...baseUser,
            status: { message: 'Deep work', emoji: '🎯' },
        })
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'user'])

        const lines = consoleSpy.mock.calls.map((call) => call[0])
        expect(lines).toContain('Status:    🎯 Deep work')
    })

    it('includes the status in the curated --json output, and omits it when there is none', async () => {
        apiMocks.getSessionUser.mockResolvedValue({
            ...baseUser,
            lang: 'en',
            status: { message: 'Deep work', emoji: '🎯' },
        })
        const consoleSpy = captureConsole('log')
        await createProgram().parseAsync(['node', 'tdc', 'user', '--json'])
        const withStatus = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(withStatus.status).toEqual({ message: 'Deep work', emoji: '🎯' })
        expect(withStatus).not.toHaveProperty('lang')

        apiMocks.getSessionUser.mockResolvedValue({ ...baseUser, status: null })
        consoleSpy.mockClear()
        await createProgram().parseAsync(['node', 'tdc', 'user', '--json'])
        expect(JSON.parse(consoleSpy.mock.calls[0][0]).status).toBeNull()
    })

    it('omits the status line when there is none', async () => {
        apiMocks.getSessionUser.mockResolvedValue({ ...baseUser, status: null })
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'user'])

        const lines = consoleSpy.mock.calls.map((call) => String(call[0]))
        expect(lines.some((line) => line.startsWith('Status:'))).toBe(false)
    })
})

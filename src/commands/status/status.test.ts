import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    getSessionUser: vi.fn(),
}))

vi.mock('../../lib/api.js', () => ({
    getCommsClient: apiMocks.getCommsClient,
    getSessionUser: apiMocks.getSessionUser,
}))

vi.mock('chalk')

import { registerStatusCommand } from './index.js'

async function run(...args: string[]): Promise<void> {
    const program = createTestProgram(registerStatusCommand)
    await program.parseAsync(['node', 'tdc', 'status', ...args])
}

const logged = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((call) => call.join(' ')).join('\n')

const NOW = new Date('2026-10-14T12:00:00.000Z')

function createUsersClient() {
    return {
        setStatus: vi.fn().mockImplementation(async (args) => ({
            id: 1,
            status: { message: args.message, emoji: args.emoji ?? null },
        })),
        clearStatus: vi.fn().mockResolvedValue({ id: 1, status: null }),
    }
}

describe('tdc status', () => {
    let users: ReturnType<typeof createUsersClient>

    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
        users = createUsersClient()
        apiMocks.getCommsClient.mockResolvedValue({ users })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('show', () => {
        it('is the default subcommand and prints the status', async () => {
            apiMocks.getSessionUser.mockResolvedValue({
                status: { message: 'Deep work', emoji: '🎯', effects: { pauseNotifications: {} } },
            })
            const spy = captureConsole('log')
            await run()
            expect(logged(spy)).toBe('🎯 Deep work (notifications paused)')
        })

        it('says so when there is no status', async () => {
            apiMocks.getSessionUser.mockResolvedValue({ status: null })
            const spy = captureConsole('log')
            await run('show')
            expect(logged(spy)).toBe('No status set.')
        })

        it('prints null in JSON when there is no status', async () => {
            apiMocks.getSessionUser.mockResolvedValue({})
            const spy = captureConsole('log')
            await run('show', '--json')
            expect(JSON.parse(logged(spy))).toEqual({ status: null })
        })
    })

    describe('set', () => {
        it('sends the message alone when nothing else is given', async () => {
            captureConsole('log')
            await run('set', 'Away')
            expect(users.setStatus).toHaveBeenCalledWith({ message: 'Away' })
        })

        it('sends emoji, an --until date and the pause effect', async () => {
            captureConsole('log')
            await run(
                'set',
                'Holiday',
                '--emoji',
                '🏝️',
                '--until',
                '2026-10-20T09:00:00Z',
                '--pause-notifications',
            )
            expect(users.setStatus).toHaveBeenCalledWith({
                message: 'Holiday',
                emoji: '🏝️',
                activeUntil: new Date('2026-10-20T09:00:00Z'),
                effects: { pauseNotifications: {} },
            })
        })

        it('turns --for into an expiry that long from now', async () => {
            captureConsole('log')
            await run('set', 'Focus', '--for', '1h30m')
            expect(users.setStatus).toHaveBeenCalledWith({
                message: 'Focus',
                activeUntil: new Date('2026-10-14T13:30:00.000Z'),
            })
        })

        it('rejects --until together with --for before calling the API', async () => {
            await expect(
                run('set', 'Focus', '--until', '2026-10-20T09:00:00Z', '--for', '2h'),
            ).rejects.toThrow('Cannot use --until and --for together')
            expect(users.setStatus).not.toHaveBeenCalled()
        })

        it.each([
            ['--until', 'next week'],
            ['--for', 'soon'],
            ['--for', '0m'],
        ])('rejects an invalid %s %s', async (flag, value) => {
            await expect(run('set', 'Focus', flag, value)).rejects.toThrow(/Invalid --/)
            expect(users.setStatus).not.toHaveBeenCalled()
        })

        it.each([['--until'], ['--for']])(
            'rejects an explicitly empty %s instead of setting no expiry',
            async (flag) => {
                captureConsole('log')
                await expect(
                    run('set', 'Focus', flag, '', '--pause-notifications'),
                ).rejects.toThrow(/Invalid --/)
                expect(users.setStatus).not.toHaveBeenCalled()
            },
        )

        it('reads a date-only --until as local midnight, not UTC', async () => {
            captureConsole('log')
            await run('set', 'Holiday', '--until', '2026-10-20')
            expect(users.setStatus).toHaveBeenCalledWith({
                message: 'Holiday',
                activeUntil: new Date(2026, 9, 20),
            })
        })

        it('prints the expiry and the pause in the text output', async () => {
            users.setStatus.mockResolvedValue({
                id: 1,
                status: {
                    message: 'Focus',
                    emoji: null,
                    activeUntil: '2026-10-14T13:30:00.000Z',
                    effects: { pauseNotifications: { scope: { mode: 'all' } } },
                },
            })
            const spy = captureConsole('log')
            await run('set', 'Focus', '--for', '90m', '--pause-notifications')
            expect(logged(spy)).toContain('until')
            expect(logged(spy)).toContain('notifications paused')
        })

        it('prints the full user with --json --full', async () => {
            users.setStatus.mockResolvedValue({ id: 1, lang: 'en', status: null })
            const spy = captureConsole('log')
            await run('set', 'Away', '--json', '--full')
            expect(JSON.parse(logged(spy))).toMatchObject({ id: 1, lang: 'en' })
        })

        it('does not call the API on --dry-run', async () => {
            const spy = captureConsole('log')
            await run('set', 'Focus', '--for', '2h', '--dry-run')
            expect(users.setStatus).not.toHaveBeenCalled()
            expect(logged(spy)).toContain('Would set status')
        })

        it('prints the stored status in JSON', async () => {
            const spy = captureConsole('log')
            await run('set', 'Away', '--json')
            expect(JSON.parse(logged(spy))).toEqual({
                status: { message: 'Away', emoji: null },
            })
        })
    })

    describe('clear', () => {
        it('clears the status', async () => {
            const spy = captureConsole('log')
            await run('clear')
            expect(users.clearStatus).toHaveBeenCalledTimes(1)
            expect(logged(spy)).toBe('Status cleared.')
        })

        it('does not call the API on --dry-run', async () => {
            captureConsole('log')
            await run('clear', '--dry-run')
            expect(users.clearStatus).not.toHaveBeenCalled()
        })
    })
})

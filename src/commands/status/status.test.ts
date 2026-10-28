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
                status: {
                    message: 'Deep work',
                    emoji: '🎯',
                    effects: { pauseNotifications: { scope: { mode: 'all' } } },
                },
            })
            const spy = captureConsole('log')
            await run()
            expect(logged(spy)).toBe('🎯 Deep work (notifications paused)')
        })

        it('names each paused effect, notifications first', async () => {
            apiMocks.getSessionUser.mockResolvedValue({
                status: {
                    message: 'Holiday',
                    effects: {
                        pauseActivity: { scope: { mode: 'all' } },
                        pauseNotifications: { scope: { mode: 'all' } },
                    },
                },
            })
            const spy = captureConsole('log')
            await run('show')
            expect(logged(spy)).toBe('Holiday (notifications paused, activity paused)')
        })

        it('shows the activity pause on its own, after the expiry', async () => {
            apiMocks.getSessionUser.mockResolvedValue({
                status: {
                    message: 'Holiday',
                    activeUntil: '2026-10-20T09:00:00.000Z',
                    effects: { pauseActivity: { scope: { mode: 'all' } } },
                },
            })
            const spy = captureConsole('log')
            await run('show')
            expect(logged(spy)).toMatch(/^Holiday \(until .+, activity paused\)$/)
            expect(logged(spy)).not.toContain('notifications paused')
        })

        it('keeps the JSON shape for a status without the effect', async () => {
            apiMocks.getSessionUser.mockResolvedValue({
                status: { message: 'Away', effects: { pauseNotifications: {} } },
            })
            const spy = captureConsole('log')
            await run('show', '--json')
            expect(JSON.parse(logged(spy))).toEqual({
                status: { message: 'Away', effects: { pauseNotifications: {} } },
            })
        })

        it('passes the activity effect through --json', async () => {
            const status = {
                message: 'Holiday',
                effects: { pauseActivity: { scope: { mode: 'all' } } },
            }
            apiMocks.getSessionUser.mockResolvedValue({ status })
            const spy = captureConsole('log')
            await run('show', '--json')
            expect(JSON.parse(logged(spy))).toEqual({ status })
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
        it('explicitly removes omitted optional values and known effects', async () => {
            captureConsole('log')
            await run('set', 'Away')
            expect(users.setStatus).toHaveBeenCalledWith({
                message: 'Away',
                emoji: null,
                activeUntil: null,
                effects: { pauseNotifications: null, pauseActivity: null },
            })
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
                effects: { pauseNotifications: {}, pauseActivity: null },
            })
        })

        it('sends only the activity effect for --pause-activity', async () => {
            captureConsole('log')
            await run('set', 'Holiday', '--pause-activity')
            expect(users.setStatus).toHaveBeenCalledWith({
                emoji: null,
                activeUntil: null,
                message: 'Holiday',
                effects: { pauseNotifications: null, pauseActivity: {} },
            })
        })

        it('sends both effects when both flags are given', async () => {
            captureConsole('log')
            await run('set', 'Holiday', '--pause-notifications', '--pause-activity')
            expect(users.setStatus).toHaveBeenCalledWith({
                emoji: null,
                activeUntil: null,
                message: 'Holiday',
                effects: { pauseNotifications: {}, pauseActivity: {} },
            })
        })

        it.each([
            { flags: [], pauseActivity: 'cleared' },
            { flags: ['--pause-activity'], pauseActivity: 'yes' },
        ])(
            'previews cleared values and Pause activity: $pauseActivity on --dry-run',
            async ({ flags, pauseActivity }) => {
                const spy = captureConsole('log')
                await run('set', 'Holiday', ...flags, '--dry-run')
                expect(users.setStatus).not.toHaveBeenCalled()
                const out = logged(spy)
                expect(out).toContain('Message: Holiday')
                expect(out).toContain('Emoji: cleared')
                expect(out).toContain('Until: cleared')
                expect(out).toContain('Pause notifications: cleared')
                expect(out).toContain(`Pause activity: ${pauseActivity}`)
            },
        )

        it('prints the activity pause in the text output', async () => {
            users.setStatus.mockResolvedValue({
                id: 1,
                status: {
                    message: 'Holiday',
                    emoji: null,
                    effects: { pauseActivity: { scope: { mode: 'all' } } },
                },
            })
            const spy = captureConsole('log')
            await run('set', 'Holiday', '--pause-activity')
            expect(logged(spy)).toBe('Status set: Holiday (activity paused)')
        })

        it('turns --for into an expiry that long from now', async () => {
            captureConsole('log')
            await run('set', 'Focus', '--for', '1h30m')
            expect(users.setStatus).toHaveBeenCalledWith({
                emoji: null,
                effects: { pauseNotifications: null, pauseActivity: null },
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
                emoji: null,
                effects: { pauseNotifications: null, pauseActivity: null },
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
            users.setStatus.mockResolvedValue({ id: 1, lang: 'en', status: { message: 'Away' } })
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

describe('tdc status set input guards', () => {
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

    const badInputs: Array<[string, string[]]> = [
        ['an empty message', ['']],
        ['a blank message', ['   ']],
        ['an 81 character message', ['x'.repeat(81)]],
        ['81 emoji', ['🎯'.repeat(81)]],
        ['an empty emoji', ['ok', '--emoji', '']],
        ['a blank emoji', ['ok', '--emoji', '  ']],
        ['an emoji that is really the next flag', ['ok', '--emoji', '--pause-notifications']],
        ['an impossible date', ['ok', '--until', '2026-02-30']],
        ['an impossible datetime', ['ok', '--until', '2026-02-31T10:00']],
        ['a month 13', ['ok', '--until', '2026-13-45']],
        ['a year only', ['ok', '--until', '2026']],
        ['a year and month only', ['ok', '--until', '2026-10']],
        ['today, which is already midnight past', ['ok', '--until', '2026-10-14']],
        ['a past datetime', ['ok', '--until', '2020-01-01T00:00:00Z']],
        ['an expiry equal to now', ['ok', '--until', '2026-10-14T12:00:00Z']],
        ['a duration that overflows to Infinity', ['ok', '--for', `${'9'.repeat(400)}m`]],
        ['a duration beyond the Date range', ['ok', '--for', '99999999999999d']],
    ]

    it.each(badInputs)('refuses %s, with and without --dry-run', async (_name, args) => {
        for (const extra of [[], ['--dry-run']]) {
            captureConsole('log')
            await expect(run('set', ...args, ...extra)).rejects.toThrow()
        }
        expect(users.setStatus).not.toHaveBeenCalled()
    })

    it('explains midnight only when the past expiry was a date with no time', async () => {
        captureConsole('log')
        const dateOnly = await run('set', 'ok', '--until', '2026-10-14').catch((e) => e)
        expect(dateOnly.hints.join(' ')).toContain('midnight')

        const withTime = await run('set', 'ok', '--until', '2020-01-01T00:00:00Z').catch((e) => e)
        expect(withTime.code).toBe('INVALID_DATE')
        expect(withTime.hints.join(' ')).not.toContain('midnight')
        expect(withTime.hints.join(' ')).toContain('future')
    })

    it('sends the trimmed message', async () => {
        captureConsole('log')
        await run('set', '  Away  ')
        expect(users.setStatus).toHaveBeenCalledWith({
            emoji: null,
            activeUntil: null,
            effects: { pauseNotifications: null, pauseActivity: null },
            message: 'Away',
        })
    })

    it.each([80, 41])(
        'counts code points, not UTF-16 units: %i emoji is accepted',
        async (count) => {
            captureConsole('log')
            await run('set', '🎯'.repeat(count))
            expect(users.setStatus).toHaveBeenCalledTimes(1)
        },
    )

    it('accepts a datetime with an offset', async () => {
        captureConsole('log')
        await run('set', 'ok', '--until', '2026-10-20T09:00+02:00')
        expect(users.setStatus).toHaveBeenCalledWith({
            emoji: null,
            effects: { pauseNotifications: null, pauseActivity: null },
            message: 'ok',
            activeUntil: new Date('2026-10-20T07:00:00Z'),
        })
    })
})

describe('tdc status reports what the server returned', () => {
    let users: ReturnType<typeof createUsersClient>

    beforeEach(() => {
        vi.clearAllMocks()
        users = createUsersClient()
        apiMocks.getCommsClient.mockResolvedValue({ users })
    })

    it.each([[[]], [['--json']], [['--json', '--full']]])(
        'set %j fails with INVALID_STATE and prints no success line when the server returns no status',
        async (extra) => {
            users.setStatus.mockResolvedValue({ id: 1, status: null })
            const spy = captureConsole('log')
            await expect(run('set', 'Away', ...extra)).rejects.toMatchObject({
                code: 'INVALID_STATE',
                message: expect.stringContaining('no active status'),
            })
            expect(spy).not.toHaveBeenCalled()
        },
    )

    it.each([[[]], [['--json']], [['--json', '--full']]])(
        'clear %j fails with INVALID_STATE, naming the status, while the server still returns one',
        async (extra) => {
            users.clearStatus.mockResolvedValue({ id: 1, status: { message: 'Still here' } })
            const spy = captureConsole('log')
            await expect(run('clear', ...extra)).rejects.toMatchObject({
                code: 'INVALID_STATE',
                message: expect.stringContaining('Still here'),
            })
            expect(spy).not.toHaveBeenCalled()
        },
    )

    it('says nothing changed, and what to do next, when set leaves no active status', async () => {
        users.setStatus.mockResolvedValue({ id: 1, status: null })
        captureConsole('log')
        const error = await run('set', 'Away').catch((e) => e)
        expect(error.code).toBe('INVALID_STATE')
        expect(error.message).toContain('Nothing changed')
        expect(error.message).toContain('no active status')
        expect(error.hints.join(' ')).toContain('tdc status')
        expect(error.hints.join(' ')).toMatch(/--until|--for/)
    })

    it('describes --pause-notifications as Comms-only, honoured by each app that reads the status', () => {
        const program = createTestProgram(registerStatusCommand)
        const set = program.commands
            .find((c) => c.name() === 'status')
            ?.commands.find((c) => c.name() === 'set')
        const help = set?.helpInformation() ?? ''
        expect(help).toContain('--pause-notifications')
        expect(help).toContain('Comms only for now')
        expect(help).toContain('each app')
    })

    it('describes --pause-activity as protecting Karma and streaks, independent of notifications', () => {
        const program = createTestProgram(registerStatusCommand)
        const set = program.commands
            .find((c) => c.name() === 'status')
            ?.commands.find((c) => c.name() === 'set')
        const help = set?.helpInformation() ?? ''
        expect(help).toContain('--pause-activity')
        expect(help).toContain('Karma')
        expect(help).toContain('streaks')
        expect(help).toMatch(/independent/i)
    })

    it('does not claim in the --pause-activity description that Comms acts on it', () => {
        const program = createTestProgram(registerStatusCommand)
        const set = program.commands
            .find((c) => c.name() === 'status')
            ?.commands.find((c) => c.name() === 'set')
        const option = set?.options.find((o) => o.long === '--pause-activity')
        expect(option?.description).toContain('Karma')
        expect(option?.description).not.toMatch(/comms/i)
    })

    it('succeeds, with one line, when set and clear do what was asked', async () => {
        const spy = captureConsole('log')
        await run('set', 'Away')
        await run('clear')
        expect(logged(spy)).toBe('Status set: Away\nStatus cleared.')
    })

    it('prints the cleared status as JSON, and the full user with --full', async () => {
        users.clearStatus.mockResolvedValue({ id: 1, lang: 'en', status: null })
        const spy = captureConsole('log')
        await run('clear', '--json')
        expect(JSON.parse(logged(spy))).toEqual({ status: null })
        spy.mockClear()
        await run('clear', '--json', '--full')
        expect(JSON.parse(logged(spy))).toMatchObject({ id: 1, lang: 'en' })
    })

    it('shows the full user with --json --full', async () => {
        apiMocks.getSessionUser.mockResolvedValue({ id: 1, lang: 'en', status: null })
        const spy = captureConsole('log')
        await run('show', '--json', '--full')
        expect(JSON.parse(logged(spy))).toMatchObject({ id: 1, lang: 'en' })
    })

    it('redacts session credentials from --json --full in show, set and clear', async () => {
        const secrets = { token: 'SESSION-TOKEN-VALUE', cometChannel: 'COMET-CHANNEL-VALUE' }
        const user = { id: 1, lang: 'en', status: { message: 'Away' }, ...secrets }
        apiMocks.getSessionUser.mockResolvedValue(user)
        users.setStatus.mockResolvedValue(user)
        users.clearStatus.mockResolvedValue({ ...user, status: null })

        for (const args of [
            ['show', '--json', '--full'],
            ['set', 'Away', '--json', '--full'],
            ['clear', '--json', '--full'],
        ]) {
            const spy = captureConsole('log')
            await run(...args)
            const out = logged(spy)
            expect(JSON.parse(out)).toMatchObject({ id: 1, lang: 'en' })
            expect(out).not.toContain('SESSION-TOKEN-VALUE')
            expect(out).not.toContain('COMET-CHANNEL-VALUE')
            spy.mockRestore()
        }
    })

    it('reaches show through the default subcommand with --json', async () => {
        apiMocks.getSessionUser.mockResolvedValue({ id: 1, status: { message: 'Away' } })
        const spy = captureConsole('log')
        await run('--json')
        expect(JSON.parse(logged(spy))).toEqual({ status: { message: 'Away' } })
    })
})

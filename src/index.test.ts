import type { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('CLI entrypoint', () => {
    const originalArgv = [...process.argv]
    const originalExitCode = process.exitCode

    async function expectSpinnerStoppedBeforeParseError(argv: string[]): Promise<void> {
        const startEarlySpinner = vi.fn()
        const stopEarlySpinner = vi.fn()
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
            code?: string | number | null,
        ) => {
            throw new Error(`process.exit(${String(code)}) should not be called`)
        }) as typeof process.exit)
        const stderrWriteSpy = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((() => true) as typeof process.stderr.write)

        vi.doMock('commander', async (importOriginal) => {
            const actual = await importOriginal<typeof import('commander')>()
            return {
                ...actual,
                program: new actual.Command(),
            }
        })
        vi.doMock('./lib/spinner.js', () => ({
            startEarlySpinner,
            stopEarlySpinner,
        }))
        vi.doMock('./lib/markdown.js', () => ({
            preloadMarkdown: vi.fn().mockResolvedValue(undefined),
        }))
        vi.doMock('./commands/conversation/index.js', () => ({
            registerConversationCommand: (program: Command) => {
                program
                    .command('conversation')
                    .command('view [conversation-ref]', { isDefault: true })
                    .action(() => undefined)
            },
        }))

        process.argv = argv

        await import('./index.js')

        expect(startEarlySpinner).toHaveBeenCalledTimes(1)
        expect(stopEarlySpinner).toHaveBeenCalled()
        expect(exitSpy).not.toHaveBeenCalled()
        expect(process.exitCode).toBe(1)
        expect(stderrWriteSpy).toHaveBeenCalledWith(expect.stringContaining('--from'))
        expect(stopEarlySpinner.mock.invocationCallOrder[0]).toBeLessThan(
            stderrWriteSpy.mock.invocationCallOrder[0],
        )
    }

    beforeEach(() => {
        vi.resetModules()
        process.argv = [...originalArgv]
        process.exitCode = undefined
    })

    afterEach(() => {
        process.argv = [...originalArgv]
        process.exitCode = originalExitCode
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it('stops the early spinner before the root parser writes parse errors', async () => {
        await expectSpinnerStoppedBeforeParseError([
            'node',
            'tdc',
            'conversation',
            'view',
            'https://comms.todoist.com/123/msg/CeRAj1WU3YFhsatbAs43L/',
            '--from',
            '2026-06-26',
        ])
    })

    it('stops the early spinner before the view proxy parser writes parse errors', async () => {
        await expectSpinnerStoppedBeforeParseError([
            'node',
            'tdc',
            'view',
            'https://comms.todoist.com/a/123/msg/CeRAj1WU3YFhsatbAs43L',
            '--from',
            '2026-06-26',
        ])
    })
})

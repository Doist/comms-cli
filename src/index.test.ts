import type { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('CLI entrypoint', () => {
    const originalArgv = [...process.argv]
    const originalExitCode = process.exitCode

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

    it('stops the early spinner before Commander writes parse errors', async () => {
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

        process.argv = [
            'node',
            'tdc',
            'conversation',
            'view',
            'https://comms.todoist.com/123/msg/ANON_MESSAGE_ID/',
            '--from',
            '2026-06-26',
        ]

        await import('./index.js')

        expect(startEarlySpinner).toHaveBeenCalledTimes(1)
        expect(stopEarlySpinner).toHaveBeenCalled()
        expect(exitSpy).not.toHaveBeenCalled()
        expect(process.exitCode).toBe(1)
        expect(stderrWriteSpy).toHaveBeenCalledWith("error: unknown option '--from'\n")
        expect(stopEarlySpinner.mock.invocationCallOrder[0]).toBeLessThan(
            stderrWriteSpy.mock.invocationCallOrder[0],
        )
    })
})

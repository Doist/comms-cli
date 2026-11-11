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

    describe('moved-package notice', () => {
        const originalIsTTY = process.stderr.isTTY

        afterEach(() => {
            Object.defineProperty(process.stderr, 'isTTY', {
                value: originalIsTTY,
                configurable: true,
            })
        })

        async function runEntrypoint(argv: string[], stderrIsTTY: boolean): Promise<string[]> {
            Object.defineProperty(process.stderr, 'isTTY', {
                value: stderrIsTTY,
                configurable: true,
            })
            const stderrWriteSpy = vi
                .spyOn(process.stderr, 'write')
                .mockImplementation((() => true) as typeof process.stderr.write)
            vi.doMock('commander', async (importOriginal) => {
                const actual = await importOriginal<typeof import('commander')>()
                return { ...actual, program: new actual.Command() }
            })
            vi.doMock('./lib/spinner.js', () => ({
                startEarlySpinner: vi.fn(),
                stopEarlySpinner: vi.fn(),
            }))
            vi.doMock('./lib/markdown.js', () => ({
                preloadMarkdown: vi.fn().mockResolvedValue(undefined),
            }))
            const registerNoop = (name: string) => (program: Command) => {
                program.command(name).action(() => undefined)
            }
            vi.doMock('./commands/inbox.js', () => ({
                registerInboxCommand: registerNoop('inbox'),
            }))
            vi.doMock('./commands/update/index.js', () => ({
                registerUpdateCommand: registerNoop('update'),
            }))

            process.argv = argv
            await import('./index.js')

            return stderrWriteSpy.mock.calls.map(([chunk]) => String(chunk))
        }

        it('writes the notice to stderr before running a command', async () => {
            const written = await runEntrypoint(['node', 'tdc', 'inbox'], true)

            expect(written).toEqual([
                expect.stringContaining(
                    'tdc has moved to @todoist/comms-cli. Run "tdc update" to switch.',
                ),
            ])
        })

        it('stays silent when stderr is not a terminal', async () => {
            const written = await runEntrypoint(['node', 'tdc', 'inbox'], false)

            expect(written).toEqual([])
        })

        it('stays silent for `tdc update`', async () => {
            const written = await runEntrypoint(['node', 'tdc', 'update'], true)

            expect(written).toEqual([])
        })
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    getProgressJsonlPath,
    includePrivateChannels,
    isAccessible,
    isNonInteractive,
    isProgressJsonlEnabled,
    parseGlobalArgs,
    resetGlobalArgs,
    shouldDisableSpinner,
} from './global-args.js'

describe('parseGlobalArgs', () => {
    describe('long flags', () => {
        it('parses --json', () => {
            expect(parseGlobalArgs(['--json']).json).toBe(true)
        })

        it('parses --ndjson', () => {
            expect(parseGlobalArgs(['--ndjson']).ndjson).toBe(true)
        })

        it('parses --ids-only', () => {
            expect(parseGlobalArgs(['--ids-only']).idsOnly).toBe(true)
        })

        it('parses --no-spinner', () => {
            expect(parseGlobalArgs(['--no-spinner']).noSpinner).toBe(true)
        })

        it('parses --accessible', () => {
            expect(parseGlobalArgs(['--accessible']).accessible).toBe(true)
        })

        it('parses --non-interactive', () => {
            expect(parseGlobalArgs(['--non-interactive']).nonInteractive).toBe(true)
        })

        it('parses --interactive', () => {
            expect(parseGlobalArgs(['--interactive']).interactive).toBe(true)
        })

        it('parses --include-private-channels', () => {
            expect(parseGlobalArgs(['--include-private-channels']).includePrivateChannels).toBe(
                true,
            )
        })

        it('defaults all flags to false/undefined', () => {
            const result = parseGlobalArgs([])
            expect(result).toEqual({
                idsOnly: false,
                json: false,
                ndjson: false,
                accessible: false,
                noSpinner: false,
                progressJsonl: false,
                progressJsonlPath: undefined,
                includePrivateChannels: false,
                nonInteractive: false,
                interactive: false,
            })
        })
    })

    describe('--progress-jsonl', () => {
        it('detects --progress-jsonl without path', () => {
            const result = parseGlobalArgs(['node', 'tdc', '--progress-jsonl'])
            expect(result.progressJsonl).toBe(true)
            expect(result.progressJsonlPath).toBeUndefined()
        })

        it('detects --progress-jsonl=path', () => {
            const result = parseGlobalArgs(['node', 'tdc', '--progress-jsonl=/tmp/out.jsonl'])
            expect(result.progressJsonl).toBe('/tmp/out.jsonl')
            expect(result.progressJsonlPath).toBe('/tmp/out.jsonl')
        })

        it('detects --progress-jsonl path as separate arg (Comms re-adds the space form cli-core drops)', () => {
            const result = parseGlobalArgs(['node', 'tdc', '--progress-jsonl', '/tmp/out.jsonl'])
            expect(result.progressJsonl).toBe('/tmp/out.jsonl')
            expect(result.progressJsonlPath).toBe('/tmp/out.jsonl')
        })

        it('does not treat next flag as path', () => {
            const result = parseGlobalArgs(['node', 'tdc', '--progress-jsonl', '--json'])
            expect(result.progressJsonl).toBe(true)
            expect(result.progressJsonlPath).toBeUndefined()
        })

        // Comms parses --progress-jsonl locally (not via cli-core) so last-occurrence
        // ordering stays correct when the forms are mixed. Regression for #209 review.
        describe('last-occurrence-wins across mixed forms', () => {
            it('=path then space form: space form wins', () => {
                const result = parseGlobalArgs([
                    'node',
                    'tdc',
                    '--progress-jsonl=/tmp/first',
                    '--progress-jsonl',
                    '/tmp/second',
                ])
                expect(result.progressJsonl).toBe('/tmp/second')
                expect(result.progressJsonlPath).toBe('/tmp/second')
            })

            it('space form then =path: =path wins', () => {
                const result = parseGlobalArgs([
                    'node',
                    'tdc',
                    '--progress-jsonl',
                    '/tmp/first',
                    '--progress-jsonl=/tmp/second',
                ])
                expect(result.progressJsonl).toBe('/tmp/second')
                expect(result.progressJsonlPath).toBe('/tmp/second')
            })

            it('path then bare: bare reverts to true (no path)', () => {
                const result = parseGlobalArgs([
                    'node',
                    'tdc',
                    '--progress-jsonl',
                    '/tmp/first',
                    '--progress-jsonl',
                ])
                expect(result.progressJsonl).toBe(true)
                expect(result.progressJsonlPath).toBeUndefined()
            })

            it('repeated =path forms: last wins', () => {
                const result = parseGlobalArgs([
                    'node',
                    'tdc',
                    '--progress-jsonl=/tmp/first',
                    '--progress-jsonl=/tmp/second',
                ])
                expect(result.progressJsonl).toBe('/tmp/second')
                expect(result.progressJsonlPath).toBe('/tmp/second')
            })
        })
    })
})

describe('cached singleton', () => {
    const originalArgv = [...process.argv]

    beforeEach(() => {
        resetGlobalArgs()
        process.argv = ['node', 'tdc']
    })

    afterEach(() => {
        process.argv = originalArgv
        resetGlobalArgs()
    })

    it('returns fresh results after resetGlobalArgs()', () => {
        process.argv = ['node', 'tdc']
        expect(isProgressJsonlEnabled()).toBe(false)

        resetGlobalArgs()
        process.argv = ['node', 'tdc', '--progress-jsonl']
        expect(isProgressJsonlEnabled()).toBe(true)
    })

    it('exposes the resolved path via getProgressJsonlPath()', () => {
        process.argv = ['node', 'tdc', '--progress-jsonl', '/tmp/out.jsonl']
        expect(getProgressJsonlPath()).toBe('/tmp/out.jsonl')
    })
})

describe('isAccessible', () => {
    const originalArgv = [...process.argv]

    beforeEach(() => {
        resetGlobalArgs()
        process.argv = ['node', 'tdc']
        delete process.env.TDC_ACCESSIBLE
    })

    afterEach(() => {
        process.argv = originalArgv
        delete process.env.TDC_ACCESSIBLE
        resetGlobalArgs()
    })

    it('returns false by default', () => {
        expect(isAccessible()).toBe(false)
    })

    it('returns true when TDC_ACCESSIBLE=1', () => {
        process.env.TDC_ACCESSIBLE = '1'
        expect(isAccessible()).toBe(true)
    })

    it('returns false when TDC_ACCESSIBLE is set to other values', () => {
        process.env.TDC_ACCESSIBLE = '0'
        expect(isAccessible()).toBe(false)
        process.env.TDC_ACCESSIBLE = 'true'
        expect(isAccessible()).toBe(false)
    })

    it('returns true when --accessible is in argv', () => {
        process.argv = ['node', 'tdc', '--accessible']
        resetGlobalArgs()
        expect(isAccessible()).toBe(true)
    })
})

describe('isNonInteractive', () => {
    const originalArgv = [...process.argv]
    let originalIsTTY: boolean | undefined

    beforeEach(() => {
        originalIsTTY = process.stdin.isTTY
        resetGlobalArgs()
        process.argv = ['node', 'tdc']
    })

    afterEach(() => {
        process.argv = originalArgv
        Object.defineProperty(process.stdin, 'isTTY', {
            value: originalIsTTY,
            configurable: true,
        })
        resetGlobalArgs()
    })

    it('returns true when stdin is not a TTY', () => {
        Object.defineProperty(process.stdin, 'isTTY', {
            value: undefined,
            configurable: true,
        })
        expect(isNonInteractive()).toBe(true)
    })

    it('returns false when stdin is a TTY', () => {
        Object.defineProperty(process.stdin, 'isTTY', {
            value: true,
            configurable: true,
        })
        expect(isNonInteractive()).toBe(false)
    })

    it('returns true when --non-interactive is set', () => {
        Object.defineProperty(process.stdin, 'isTTY', {
            value: true,
            configurable: true,
        })
        process.argv = ['node', 'tdc', '--non-interactive']
        resetGlobalArgs()
        expect(isNonInteractive()).toBe(true)
    })

    it('returns false when --interactive is set even without TTY', () => {
        Object.defineProperty(process.stdin, 'isTTY', {
            value: undefined,
            configurable: true,
        })
        process.argv = ['node', 'tdc', '--interactive']
        resetGlobalArgs()
        expect(isNonInteractive()).toBe(false)
    })

    it('--interactive overrides --non-interactive', () => {
        process.argv = ['node', 'tdc', '--non-interactive', '--interactive']
        resetGlobalArgs()
        expect(isNonInteractive()).toBe(false)
    })
})

describe('includePrivateChannels', () => {
    const originalArgv = [...process.argv]
    const originalEnv = process.env.COMMS_INCLUDE_PRIVATE_CHANNELS

    beforeEach(() => {
        resetGlobalArgs()
        process.argv = ['node', 'tdc']
        delete process.env.COMMS_INCLUDE_PRIVATE_CHANNELS
    })

    afterEach(() => {
        process.argv = originalArgv
        if (originalEnv !== undefined) {
            process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = originalEnv
        } else {
            delete process.env.COMMS_INCLUDE_PRIVATE_CHANNELS
        }
        resetGlobalArgs()
    })

    it('returns false by default', () => {
        expect(includePrivateChannels()).toBe(false)
    })

    it('returns true when --include-private-channels is in argv', () => {
        process.argv = ['node', 'tdc', '--include-private-channels']
        resetGlobalArgs()
        expect(includePrivateChannels()).toBe(true)
    })

    it('returns true when COMMS_INCLUDE_PRIVATE_CHANNELS=1', () => {
        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = '1'
        expect(includePrivateChannels()).toBe(true)
    })

    it('returns true when COMMS_INCLUDE_PRIVATE_CHANNELS=true', () => {
        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = 'true'
        expect(includePrivateChannels()).toBe(true)
    })

    it('returns false for other env values', () => {
        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = '0'
        expect(includePrivateChannels()).toBe(false)
        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = 'false'
        expect(includePrivateChannels()).toBe(false)
    })
})

describe('shouldDisableSpinner', () => {
    const originalArgv = [...process.argv]

    beforeEach(() => {
        resetGlobalArgs()
        process.argv = ['node', 'tdc']
        delete process.env.TDC_SPINNER
        delete process.env.CI
    })

    afterEach(() => {
        process.argv = originalArgv
        delete process.env.TDC_SPINNER
        delete process.env.CI
        resetGlobalArgs()
    })

    it('returns false by default', () => {
        expect(shouldDisableSpinner()).toBe(false)
    })

    it('returns true when TDC_SPINNER=false', () => {
        process.env.TDC_SPINNER = 'false'
        expect(shouldDisableSpinner()).toBe(true)
    })

    it('returns true when CI is set', () => {
        process.env.CI = 'true'
        expect(shouldDisableSpinner()).toBe(true)
    })

    it("treats CI='false' as opt-out (does not disable the spinner)", () => {
        // cli-core's isCI() honours CI='false' as a deliberate opt-out so a
        // nested invocation can run interactively even when the parent shell
        // exports CI=true. Regression test for the cli-core gate.
        process.env.CI = 'false'
        expect(shouldDisableSpinner()).toBe(false)
    })

    it.each([
        ['--json', ['node', 'tdc', '--json']],
        ['--ndjson', ['node', 'tdc', '--ndjson']],
        ['--no-spinner', ['node', 'tdc', '--no-spinner']],
        ['--progress-jsonl', ['node', 'tdc', '--progress-jsonl']],
        ['--non-interactive', ['node', 'tdc', '--non-interactive']],
    ])('returns true with %s flag', (_flag, argv) => {
        process.argv = argv
        resetGlobalArgs()
        expect(shouldDisableSpinner()).toBe(true)
    })
})

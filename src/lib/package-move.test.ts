import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeMovedNotice } from './package-move.js'

vi.mock('chalk')

const NOTICE = 'tdc has moved to @todoist/comms-cli. Run "tdc update" to switch.\n'

describe('writeMovedNotice', () => {
    let originalIsTTY: boolean

    function setStderrTTY(value: boolean | undefined) {
        Object.defineProperty(process.stderr, 'isTTY', { value, configurable: true })
    }

    beforeEach(() => {
        originalIsTTY = process.stderr.isTTY
    })

    afterEach(() => {
        setStderrTTY(originalIsTTY)
        vi.restoreAllMocks()
    })

    function captureStderr() {
        return vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((() => true) as typeof process.stderr.write)
    }

    it.each([['inbox'], ['thread'], [undefined]])(
        'writes the notice to stderr when stderr is a terminal (command: %s)',
        (command) => {
            setStderrTTY(true)
            const write = captureStderr()

            writeMovedNotice(command)

            expect(write).toHaveBeenCalledTimes(1)
            expect(write).toHaveBeenCalledWith(NOTICE)
        },
    )

    it.each([[false], [undefined]])('stays silent when stderr.isTTY is %s', (isTTY) => {
        setStderrTTY(isTTY)
        const write = captureStderr()

        writeMovedNotice('inbox')

        expect(write).not.toHaveBeenCalled()
    })

    it.each([['update'], ['completion-server']])(
        'stays silent for `%s` even on a terminal',
        (command) => {
            setStderrTTY(true)
            const write = captureStderr()

            writeMovedNotice(command)

            expect(write).not.toHaveBeenCalled()
        },
    )
})

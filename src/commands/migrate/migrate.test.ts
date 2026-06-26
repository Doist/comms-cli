import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdkMocks = vi.hoisted(() => ({
    fetchNewCommsUrls: vi.fn(),
}))

vi.mock('@doist/comms-sdk', () => ({
    fetchNewCommsUrls: sdkMocks.fetchNewCommsUrls,
}))

const inputMocks = vi.hoisted(() => ({
    readStdin: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../lib/input.js', () => ({
    readStdin: inputMocks.readStdin,
}))

vi.mock('chalk')

import { readStdin } from '../../lib/input.js'
import { registerMigrateCommand } from './index.js'

const createProgram = () => createTestProgram(registerMigrateCommand)

const OLD_URL = 'https://twist.com/a/1/ch/2/t/3'
const NEW_URL = 'https://comms.todoist.com/a/1/ch/2/t/3'

function success(oldUrl: string, newUrl: string) {
    return { oldUrl, newUrl }
}

function failure(oldUrl: string, code: string, message = 'Request failed') {
    return { oldUrl, error: { message, responseData: { error: { code } } } }
}

describe('migrate urls', () => {
    const originalToken = process.env.TWIST_AUTH_TOKEN
    const originalBaseUrl = process.env.TWIST_BASE_URL

    beforeEach(() => {
        vi.clearAllMocks()
        inputMocks.readStdin.mockResolvedValue(null)
        delete process.env.TWIST_AUTH_TOKEN
        delete process.env.TWIST_BASE_URL
        process.exitCode = undefined
    })

    afterEach(() => {
        if (originalToken === undefined) delete process.env.TWIST_AUTH_TOKEN
        else process.env.TWIST_AUTH_TOKEN = originalToken
        if (originalBaseUrl === undefined) delete process.env.TWIST_BASE_URL
        else process.env.TWIST_BASE_URL = originalBaseUrl
        process.exitCode = undefined
    })

    it('parses a comma-separated argument and passes URLs + flag token to the SDK', async () => {
        sdkMocks.fetchNewCommsUrls.mockResolvedValue([
            success(OLD_URL, NEW_URL),
            success('https://twist.com/a/1/ch/2/t/4', 'https://comms.todoist.com/a/1/ch/2/t/4'),
        ])
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'migrate',
            'urls',
            `${OLD_URL},https://twist.com/a/1/ch/2/t/4`,
            '--twist-token',
            'flag-token',
        ])

        expect(sdkMocks.fetchNewCommsUrls).toHaveBeenCalledWith(
            {
                oldUrls: [OLD_URL, 'https://twist.com/a/1/ch/2/t/4'],
                twistToken: 'flag-token',
            },
            undefined,
        )
        expect(consoleSpy).toHaveBeenCalledWith(`${OLD_URL} -> ${NEW_URL}`)
    })

    it('reads URLs from stdin when no argument is given', async () => {
        inputMocks.readStdin.mockResolvedValue(`${OLD_URL}\nhttps://twist.com/a/1/ch/2/t/4\n`)
        sdkMocks.fetchNewCommsUrls.mockResolvedValue([success(OLD_URL, NEW_URL)])
        captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'migrate',
            'urls',
            '--twist-token',
            'flag-token',
        ])

        expect(readStdin).toHaveBeenCalled()
        expect(sdkMocks.fetchNewCommsUrls).toHaveBeenCalledWith(
            expect.objectContaining({
                oldUrls: [OLD_URL, 'https://twist.com/a/1/ch/2/t/4'],
            }),
            undefined,
        )
    })

    it('falls back to TWIST_AUTH_TOKEN when no flag is provided', async () => {
        process.env.TWIST_AUTH_TOKEN = 'env-token'
        sdkMocks.fetchNewCommsUrls.mockResolvedValue([success(OLD_URL, NEW_URL)])
        captureConsole('log')

        await createProgram().parseAsync(['node', 'tdc', 'migrate', 'urls', OLD_URL])

        expect(sdkMocks.fetchNewCommsUrls).toHaveBeenCalledWith(
            expect.objectContaining({ twistToken: 'env-token' }),
            undefined,
        )
    })

    it('errors with NO_TOKEN when neither flag nor env var is set', async () => {
        await expect(
            createProgram().parseAsync(['node', 'tdc', 'migrate', 'urls', OLD_URL]),
        ).rejects.toHaveProperty('code', 'NO_TOKEN')
        expect(sdkMocks.fetchNewCommsUrls).not.toHaveBeenCalled()
    })

    it('errors with MISSING_CONTENT when no URLs are provided', async () => {
        await expect(
            createProgram().parseAsync([
                'node',
                'tdc',
                'migrate',
                'urls',
                '--twist-token',
                'flag-token',
            ]),
        ).rejects.toHaveProperty('code', 'MISSING_CONTENT')
        expect(sdkMocks.fetchNewCommsUrls).not.toHaveBeenCalled()
    })

    it('emits structured JSON with --json', async () => {
        sdkMocks.fetchNewCommsUrls.mockResolvedValue([
            success(OLD_URL, NEW_URL),
            failure('https://twist.com/bad', 'invalid_url'),
        ])
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'migrate',
            'urls',
            `${OLD_URL},https://twist.com/bad`,
            '--twist-token',
            'flag-token',
            '--json',
        ])

        const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string)
        expect(parsed).toEqual([
            { oldUrl: OLD_URL, newUrl: NEW_URL },
            {
                oldUrl: 'https://twist.com/bad',
                error: { code: 'invalid_url', message: 'Request failed' },
            },
        ])
    })

    it('prints a ✗ line and sets a non-zero exit code on partial failure', async () => {
        sdkMocks.fetchNewCommsUrls.mockResolvedValue([
            success(OLD_URL, NEW_URL),
            failure('https://twist.com/bad', 'not_imported'),
        ])
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'migrate',
            'urls',
            `${OLD_URL},https://twist.com/bad`,
            '--twist-token',
            'flag-token',
        ])

        expect(consoleSpy).toHaveBeenCalledWith(`${OLD_URL} -> ${NEW_URL}`)
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('https://twist.com/bad'))
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗ not_imported'))
        expect(process.exitCode).toBe(1)
    })

    it('emits newline-delimited JSON with --ndjson', async () => {
        sdkMocks.fetchNewCommsUrls.mockResolvedValue([
            success(OLD_URL, NEW_URL),
            failure('https://twist.com/bad', 'invalid_url'),
        ])
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'migrate',
            'urls',
            `${OLD_URL},https://twist.com/bad`,
            '--twist-token',
            'flag-token',
            '--ndjson',
        ])

        const lines = (consoleSpy.mock.calls[0][0] as string).split('\n').filter(Boolean)
        expect(lines.map((line) => JSON.parse(line))).toEqual([
            { oldUrl: OLD_URL, newUrl: NEW_URL },
            {
                oldUrl: 'https://twist.com/bad',
                error: { code: 'invalid_url', message: 'Request failed' },
            },
        ])
    })

    it('falls back to a stable API_ERROR code when the failure carries no code', async () => {
        sdkMocks.fetchNewCommsUrls.mockResolvedValue([
            { oldUrl: OLD_URL, error: { message: 'boom', responseData: undefined } },
        ])
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'migrate',
            'urls',
            OLD_URL,
            '--twist-token',
            'flag-token',
            '--json',
        ])

        const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string)
        expect(parsed).toEqual([{ oldUrl: OLD_URL, error: { code: 'API_ERROR', message: 'boom' } }])
        expect(process.exitCode).toBe(1)
    })

    it('forwards TWIST_BASE_URL to the SDK as { baseUrl }', async () => {
        process.env.TWIST_BASE_URL = 'https://staging.twist.com'
        sdkMocks.fetchNewCommsUrls.mockResolvedValue([success(OLD_URL, NEW_URL)])
        captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'migrate',
            'urls',
            OLD_URL,
            '--twist-token',
            'flag-token',
        ])

        expect(sdkMocks.fetchNewCommsUrls).toHaveBeenCalledWith(expect.any(Object), {
            baseUrl: 'https://staging.twist.com',
        })
    })
})

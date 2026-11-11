import { createTestProgram } from '@todoist/cli-core/testing'
import type { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }

// `usageTracking` reads the agent once, when its module loads, so the stub runs before the
// import. Without it, `cli-agent` would depend on whichever agent (if any) runs the tests.
vi.hoisted(() => {
    vi.stubEnv('AI_AGENT', 'claude-code_1.0.0_agent')
})

type RecordedRequest = { method: string; headers: Record<string, string> }

const sdk = vi.hoisted(() => ({ requests: [] as RecordedRequest[] }))

vi.mock('@todoist/comms-sdk', async (importActual) => {
    const actual = await importActual<typeof import('@todoist/comms-sdk')>()
    type HeadersOption = Record<string, string> | (() => Record<string, string>)
    // Every method records the headers the real SDK would send with that one
    // request (it calls a `headers` function once per request), then fails, so
    // a command stops at its first API call.
    class CommsApi {
        constructor(_token: string, options: { headers?: HeadersOption } = {}) {
            const requestHeaders = () =>
                typeof options.headers === 'function' ? options.headers() : options.headers
            const group = (name: string) =>
                new Proxy(
                    {},
                    {
                        get: (_target, method) => async () => {
                            sdk.requests.push({
                                method: `${name}.${String(method)}`,
                                headers: { ...requestHeaders() },
                            })
                            throw new Error('stop after the first request')
                        },
                    },
                )
            return new Proxy(this, {
                get: (_target, name) => (name === 'then' ? undefined : group(String(name))),
            })
        }
    }
    return { ...actual, CommsApi }
})

vi.mock('./auth.js', () => ({
    getApiTokenSnapshot: vi.fn().mockResolvedValue({
        token: 'test-token',
        account: {
            id: '42',
            label: 'Alan',
            authMode: 'read-write',
            authResource: 'https://comms.todoist.com',
            authScope: '',
        },
    }),
    getAuthMetadata: vi.fn().mockResolvedValue({ authMode: 'read-write' }),
}))

vi.mock('./spinner.js', () => ({
    withSpinner: <T>(_label: unknown, fn: () => Promise<T>) => fn(),
    startEarlySpinner: vi.fn(),
    stopEarlySpinner: vi.fn(),
}))

const { clearApiClientCache, clearWorkspaceUserCache } = await import('./api.js')
const { trackCommandUsage, withUsageHeaders } = await import('./usage-tracking.js')
const { registerUserCommand } = await import('../commands/user.js')
const { registerThreadCommand } = await import('../commands/thread/index.js')
const { registerViewCommand } = await import('../commands/view.js')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const THREAD_ID = 'CeRAj1WU3YFhsVZGDyPr9'
const THREAD_URL = `https://comms.todoist.com/a/1585/ch/CeRAj1WU3YFhsTejuePLW/t/${THREAD_ID}`

function createProgram(): Command {
    return trackCommandUsage(
        createTestProgram((program) => {
            registerUserCommand(program)
            registerThreadCommand(program)
            registerViewCommand(program)
        }),
    )
}

/** Runs `tdc <args>` and returns the headers of each API request it made. */
async function headersSentBy(...args: string[]): Promise<Record<string, string>[]> {
    await createProgram()
        .parseAsync(['node', 'tdc', ...args])
        .catch(() => {})
    return sdk.requests.map((request) => request.headers)
}

describe('CLI usage headers on API requests', () => {
    beforeEach(() => {
        sdk.requests.length = 0
        clearApiClientCache()
        clearWorkspaceUserCache()
    })

    it('sends the CLI identity, OS, request, session and running command with each request', async () => {
        const [headers] = await headersSentBy('user')

        expect(sdk.requests[0]?.method).toBe('users.getSessionUser')
        expect(headers).toEqual({
            'User-Agent': `comms-cli/${packageJson.version}`,
            'doist-platform': 'cli',
            'doist-version': packageJson.version,
            'doist-os': expect.stringMatching(/^(macos|linux|windows|unknown)$/),
            'request-id': expect.stringMatching(UUID),
            'session-id': expect.stringMatching(UUID),
            'cli-command': 'user',
            'cli-agent': 'claude-code',
        })
    })

    it.each([
        [`thread id:${THREAD_ID}`, 'thread:view'],
        [`thread view id:${THREAD_ID}`, 'thread:view'],
        [`view ${THREAD_URL}`, 'thread:view'],
    ])('labels `tdc %s` requests as %s', async (command, label) => {
        const [headers] = await headersSentBy(...command.split(' '))

        expect(headers?.['cli-command']).toBe(label)
    })

    it('keeps one session ID but gives each request of a run its own request ID', async () => {
        const [getThread, getComments] = await headersSentBy('thread', `id:${THREAD_ID}`)

        expect(sdk.requests).toHaveLength(2)
        expect(getThread?.['session-id']).toMatch(UUID)
        expect(getComments?.['session-id']).toBe(getThread?.['session-id'])
        expect(getThread?.['request-id']).toMatch(UUID)
        expect(getComments?.['request-id']).toMatch(UUID)
        expect(getComments?.['request-id']).not.toBe(getThread?.['request-id'])
    })
})

/**
 * Calls `fetch` through `withUsageHeaders` and returns the headers the request
 * would go out with: the fake `fetch` builds the request from its arguments the
 * same way the real one does, so `init.headers` replaces a Request's own.
 */
async function headersFetchedWith(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Record<string, string>> {
    const sent: Headers[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(new Request(input, init).headers)
        return new Response()
    })

    await withUsageHeaders(fetchImpl)(input, init)

    expect(sent).toHaveLength(1)
    return Object.fromEntries(sent[0]?.entries() ?? [])
}

describe('withUsageHeaders', () => {
    const TOKEN_URL = 'https://auth.example.com/oauth/access_token'

    it('adds the usage headers to the headers passed in `init`', async () => {
        const headers = await headersFetchedWith(TOKEN_URL, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })

        expect(headers).toMatchObject({
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': `comms-cli/${packageJson.version}`,
            'doist-platform': 'cli',
        })
    })

    it("keeps a Request's own headers when `init` has none", async () => {
        const request = new Request(TOKEN_URL, {
            headers: { Authorization: 'Bearer request-token' },
        })

        const headers = await headersFetchedWith(request)

        expect(headers).toMatchObject({
            authorization: 'Bearer request-token',
            'user-agent': `comms-cli/${packageJson.version}`,
            'doist-platform': 'cli',
        })
    })

    it("uses `init.headers` over a Request's own headers, as fetch does", async () => {
        const request = new Request(TOKEN_URL, {
            headers: { Authorization: 'Bearer request-token', 'X-Request-Only': 'dropped' },
        })

        const headers = await headersFetchedWith(request, {
            headers: { Authorization: 'Bearer init-token' },
        })

        expect(headers).toMatchObject({
            authorization: 'Bearer init-token',
            'doist-platform': 'cli',
        })
        expect(headers).not.toHaveProperty('x-request-only')
    })

    it("sends the usage headers over a Request's header of the same name", async () => {
        const request = new Request(TOKEN_URL, { headers: { 'User-Agent': 'other-client/1.0' } })

        const headers = await headersFetchedWith(request)

        expect(headers['user-agent']).toBe(`comms-cli/${packageJson.version}`)
    })
})

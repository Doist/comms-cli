import { captureConsole, createTestProgram } from '@todoist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    getCurrentWorkspaceId: vi.fn(),
}))

const refsMocks = vi.hoisted(() => ({
    resolveWorkspaceRef: vi.fn(),
    resolveChannelRef: vi.fn(),
}))

vi.mock('../../lib/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/api.js')>()),
    ...apiMocks,
}))

vi.mock('../../lib/refs.js', () => ({
    resolveWorkspaceRef: refsMocks.resolveWorkspaceRef,
    resolveChannelRef: refsMocks.resolveChannelRef,
}))

vi.mock('../../lib/global-args.js', async (importOriginal) => ({
    ...(await importOriginal()),
    includePrivateChannels: vi.fn().mockReturnValue(true),
    isAccessible: vi.fn().mockReturnValue(false),
}))

vi.mock('../../lib/public-channels.js', () => ({
    assertChannelIsPublic: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('chalk')

import { CliError } from '../../lib/errors.js'
import { assertChannelIsPublic } from '../../lib/public-channels.js'
import { decodeCursor, encodeCursor } from './helpers.js'
import { registerChannelCommand } from './index.js'

const createProgram = () => createTestProgram(registerChannelCommand)

type Thread = {
    id: string
    title: string
    channelId: string
    workspaceId: number
    creator: number
    commentCount: number
    lastUpdated: Date
    posted: Date
    isArchived: boolean
    url: string
    pinned?: boolean
    snippet?: string
    snippetCreator?: number
    starred?: boolean
    content?: string
}

function createThread(id: number | string, overrides: Partial<Thread> = {}): Thread {
    const sid = String(id)
    const numeric = typeof id === 'number' ? id : Number(id) || 1
    return {
        id: sid,
        title: `Thread ${sid}`,
        channelId: 'CH100',
        workspaceId: 1,
        creator: 999,
        commentCount: 0,
        lastUpdated: new Date(`2026-01-${String(numeric).padStart(2, '0')}T00:00:00Z`),
        posted: new Date(`2026-01-${String(numeric).padStart(2, '0')}T00:00:00Z`),
        isArchived: false,
        url: `https://comms.todoist.com/a/1/ch/CH100/t/${sid}`,
        pinned: false,
        snippet: '',
        snippetCreator: 999,
        starred: false,
        content: '',
        ...overrides,
    }
}

type UnreadEntry = { threadId: string; channelId?: string; directMention?: boolean }

function setupClient({
    threads = [],
    unread = [],
}: {
    threads?: Thread[]
    unread?: UnreadEntry[] | null
} = {}) {
    const mockGetThreads = vi.fn().mockResolvedValue(threads)
    const mockGetUnread = vi.fn().mockResolvedValue({ data: unread ?? [], version: 1 })

    apiMocks.getCommsClient.mockResolvedValue({
        threads: { getThreads: mockGetThreads, getUnread: mockGetUnread },
    })

    return { mockGetThreads, mockGetUnread }
}

function channel(id = 'CH100', name = 'general') {
    return { id, name, workspaceId: 1, archived: false, public: true }
}

describe('channel threads', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        refsMocks.resolveChannelRef.mockResolvedValue(channel())
    })

    it('errors when both positional workspace and --workspace are provided', async () => {
        setupClient()
        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'channel',
                'threads',
                'general',
                'Doist',
                '--workspace',
                'Other',
            ]),
        ).rejects.toThrow('Cannot specify workspace both as argument and --workspace flag')
    })

    it('resolves channel via resolveChannelRef', async () => {
        setupClient()
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', 'general', '--json'])

        expect(refsMocks.resolveChannelRef).toHaveBeenCalledWith('general', 1)
    })

    it('uses workspace from positional arg when provided', async () => {
        refsMocks.resolveWorkspaceRef.mockResolvedValue({ id: 42, name: 'Doist' })
        setupClient()
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            'general',
            'Doist',
            '--json',
        ])

        expect(refsMocks.resolveWorkspaceRef).toHaveBeenCalledWith('Doist')
        expect(refsMocks.resolveChannelRef).toHaveBeenCalledWith('general', 42)
    })

    it('passes archived:false to getThreads by default', async () => {
        const { mockGetThreads } = setupClient()
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json'])

        expect(mockGetThreads).toHaveBeenCalledWith({
            workspaceId: 1,
            channelId: 'CH100',
            archived: false,
            limit: 51,
        })
    })

    it('--archive-filter all omits archived', async () => {
        const { mockGetThreads } = setupClient()
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--archive-filter',
            'all',
            '--json',
        ])

        expect(mockGetThreads).toHaveBeenCalledWith({
            workspaceId: 1,
            channelId: 'CH100',
            limit: 51,
        })
    })

    it('--archive-filter archived passes archived:true', async () => {
        const { mockGetThreads } = setupClient()
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--archive-filter',
            'archived',
            '--json',
        ])

        expect(mockGetThreads).toHaveBeenCalledWith({
            workspaceId: 1,
            channelId: 'CH100',
            archived: true,
            limit: 51,
        })
    })

    it('merges isUnread from getUnread set', async () => {
        setupClient({
            threads: [createThread(1), createThread(2), createThread(3)],
            unread: [{ threadId: '2' }],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results.find((t: { id: string }) => t.id === '1').isUnread).toBe(false)
        expect(output.results.find((t: { id: string }) => t.id === '2').isUnread).toBe(true)
        expect(output.results.find((t: { id: string }) => t.id === '3').isUnread).toBe(false)
    })

    it('--unread filters to unread threads only', async () => {
        setupClient({
            threads: [createThread(1), createThread(2), createThread(3)],
            unread: [{ threadId: '2', channelId: 'CH100' }],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--unread',
            '--json',
        ])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results).toHaveLength(1)
        expect(output.results[0].id).toBe('2')
    })

    it('--since filters by lastUpdated', async () => {
        setupClient({
            threads: [
                createThread(1, { lastUpdated: new Date('2026-01-01T00:00:00Z') }),
                createThread(2, { lastUpdated: new Date('2026-02-01T00:00:00Z') }),
                createThread(3, { lastUpdated: new Date('2026-03-01T00:00:00Z') }),
            ],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--since',
            '2026-02-01',
            '--json',
        ])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results.map((t: { id: string }) => t.id).sort()).toEqual(['2', '3'])
    })

    it('--until filters by lastUpdated (exclusive)', async () => {
        setupClient({
            threads: [
                createThread(1, { lastUpdated: new Date('2026-01-01T00:00:00Z') }),
                createThread(2, { lastUpdated: new Date('2026-02-01T00:00:00Z') }),
                createThread(3, { lastUpdated: new Date('2026-03-01T00:00:00Z') }),
            ],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--until',
            '2026-02-01',
            '--json',
        ])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results.map((t: { id: string }) => t.id)).toEqual(['1'])
    })

    it('sorts newest-first by lastUpdated', async () => {
        setupClient({
            threads: [
                createThread(1, { lastUpdated: new Date('2026-01-01T00:00:00Z') }),
                createThread(2, { lastUpdated: new Date('2026-03-01T00:00:00Z') }),
                createThread(3, { lastUpdated: new Date('2026-02-01T00:00:00Z') }),
            ],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results.map((t: { id: string }) => t.id)).toEqual(['2', '3', '1'])
    })

    it('--limit truncates results and emits nextCursor', async () => {
        setupClient({
            threads: [
                createThread(1, { lastUpdated: new Date('2026-01-05T00:00:00Z') }),
                createThread(2, { lastUpdated: new Date('2026-01-04T00:00:00Z') }),
                createThread(3, { lastUpdated: new Date('2026-01-03T00:00:00Z') }),
                createThread(4, { lastUpdated: new Date('2026-01-02T00:00:00Z') }),
                createThread(5, { lastUpdated: new Date('2026-01-01T00:00:00Z') }),
            ],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--limit',
            '2',
            '--json',
        ])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results.map((t: { id: string }) => t.id)).toEqual(['1', '2'])
        expect(output.nextCursor).toEqual(
            encodeCursor({ before: Date.parse('2026-01-04T00:00:00Z'), shown: ['2'] }),
        )
    })

    it('--ids-only keeps pagination notices on stderr and skips unread enrichment', async () => {
        const { mockGetUnread } = setupClient({
            threads: [
                createThread(1, { lastUpdated: new Date('2026-01-03T00:00:00Z') }),
                createThread(2, { lastUpdated: new Date('2026-01-02T00:00:00Z') }),
                createThread(3, { lastUpdated: new Date('2026-01-01T00:00:00Z') }),
            ],
        })
        const consoleSpy = captureConsole('log')
        const errorSpy = captureConsole('error')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--ids-only',
            '--limit',
            '2',
        ])

        expect(consoleSpy).toHaveBeenCalledWith('1\n2')
        expect(errorSpy).toHaveBeenCalledWith(
            `More threads available. Use --cursor ${encodeCursor({ before: Date.parse('2026-01-02T00:00:00Z'), shown: ['2'] })}`,
        )
        expect(mockGetUnread).not.toHaveBeenCalled()
    })

    it('--cursor advances to the next page', async () => {
        setupClient({
            threads: [
                createThread(1, { lastUpdated: new Date('2026-01-05T00:00:00Z') }),
                createThread(2, { lastUpdated: new Date('2026-01-04T00:00:00Z') }),
                createThread(3, { lastUpdated: new Date('2026-01-03T00:00:00Z') }),
                createThread(4, { lastUpdated: new Date('2026-01-02T00:00:00Z') }),
                createThread(5, { lastUpdated: new Date('2026-01-01T00:00:00Z') }),
            ],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--limit',
            '2',
            '--cursor',
            encodeCursor({ before: Date.parse('2026-01-04T00:00:00Z'), shown: ['2'] }),
            '--json',
        ])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results.map((t: { id: string }) => t.id)).toEqual(['3', '4'])
        expect(output.nextCursor).toEqual(
            encodeCursor({ before: Date.parse('2026-01-02T00:00:00Z'), shown: ['4'] }),
        )
    })

    it('nextCursor is null on the last page', async () => {
        setupClient({
            threads: [createThread(1), createThread(2)],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.nextCursor).toBeNull()
    })

    it('calls assertChannelIsPublic after resolving the channel', async () => {
        setupClient({ threads: [createThread(1)] })
        captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json'])

        expect(vi.mocked(assertChannelIsPublic)).toHaveBeenCalledWith('CH100', 1, true)
    })

    it('propagates the error when the channel is private and the guard rejects', async () => {
        setupClient({ threads: [createThread(1)] })
        vi.mocked(assertChannelIsPublic).mockRejectedValueOnce(
            new CliError('NOT_FOUND', 'This thread belongs to a private channel.'),
        )
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json']),
        ).rejects.toThrow('This thread belongs to a private channel.')
    })

    it('rejects an invalid --since with INVALID_DATE', async () => {
        setupClient({ threads: [createThread(1)] })
        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'channel',
                'threads',
                '12345',
                '--since',
                'not-a-date',
                '--json',
            ]),
        ).rejects.toHaveProperty('code', 'INVALID_DATE')
    })

    it('rejects an invalid --until with INVALID_DATE', async () => {
        setupClient({ threads: [createThread(1)] })
        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'channel',
                'threads',
                '12345',
                '--until',
                'junk',
                '--json',
            ]),
        ).rejects.toHaveProperty('code', 'INVALID_DATE')
    })

    it('rejects a malformed --cursor with INVALID_CURSOR', async () => {
        setupClient({ threads: [createThread(1)] })
        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'channel',
                'threads',
                '12345',
                '--cursor',
                '!!!not-base64!!!',
                '--json',
            ]),
        ).rejects.toHaveProperty('code', 'INVALID_CURSOR')
    })

    it('prints empty-state message when no threads', async () => {
        refsMocks.resolveChannelRef.mockResolvedValue(channel('CH100', 'general'))
        setupClient({ threads: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', 'general'])

        expect(consoleSpy).toHaveBeenCalledWith('No threads in #general.')
    })

    it('--json emits isUnread, hasUnreadMention and url without --full', async () => {
        setupClient({
            threads: [createThread(1)],
            unread: [{ threadId: '1', directMention: true }],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results[0]).toMatchObject({
            id: '1',
            isUnread: true,
            hasUnreadMention: true,
            url: 'https://comms.todoist.com/a/1/ch/CH100/t/1',
        })
    })

    it('--ndjson emits one thread per line plus _meta terminator when paginated', async () => {
        setupClient({
            threads: [
                createThread(1, { lastUpdated: new Date('2026-01-05T00:00:00Z') }),
                createThread(2, { lastUpdated: new Date('2026-01-04T00:00:00Z') }),
                createThread(3, { lastUpdated: new Date('2026-01-03T00:00:00Z') }),
            ],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync([
            'node',
            'tdc',
            'channel',
            'threads',
            '12345',
            '--ndjson',
            '--limit',
            '2',
        ])

        const lines = (consoleSpy.mock.calls[0][0] as string).split('\n')
        expect(lines).toHaveLength(3)
        const first = JSON.parse(lines[0])
        const second = JSON.parse(lines[1])
        const meta = JSON.parse(lines[2])
        expect(first.id).toBe('1')
        expect(second.id).toBe('2')
        expect(meta).toEqual({
            _meta: true,
            nextCursor: encodeCursor({ before: Date.parse('2026-01-04T00:00:00Z'), shown: ['2'] }),
        })
    })

    it('treats getUnread returning empty data as no unread threads', async () => {
        setupClient({ threads: [createThread(1)], unread: [] })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json']),
        ).resolves.not.toThrow()

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results).toHaveLength(1)
        expect(output.results[0].isUnread).toBe(false)
    })

    it('surfaces API error when getThreads rejects', async () => {
        apiMocks.getCommsClient.mockResolvedValue({
            threads: {
                getThreads: vi.fn().mockRejectedValue(new Error('Channel access denied')),
                getUnread: vi.fn().mockResolvedValue({ data: [], version: 1 }),
            },
        })
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json']),
        ).rejects.toThrow('Channel access denied')
    })

    it('--full bypasses the essential-field filter in JSON output', async () => {
        setupClient({
            threads: [createThread(1, { pinned: true })],
        })
        const consoleSpy = captureConsole('log')
        const program = createProgram()

        await program.parseAsync(['node', 'tdc', 'channel', 'threads', '12345', '--json', '--full'])

        const output = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(output.results[0]).toHaveProperty('pinned', true)
    })
})

type GetThreadsCall = { newerThan?: Date; olderThan?: Date; limit?: number }

// Behaves like threads/get: most recently active first with id as the tiebreaker, date bounds
// that are inclusive and in whole seconds, and 20 threads unless the call asks for more.
function setupBackend(threads: Thread[], unread: UnreadEntry[] = []) {
    const seconds = (date: Date) => Math.floor(date.getTime() / 1000)
    const mockGetThreads = vi.fn(async ({ newerThan, olderThan, limit }: GetThreadsCall) =>
        threads
            .filter((t) => !newerThan || seconds(t.lastUpdated) >= seconds(newerThan))
            .filter((t) => !olderThan || seconds(t.lastUpdated) <= seconds(olderThan))
            .sort(
                (a, b) =>
                    b.lastUpdated.getTime() - a.lastUpdated.getTime() || a.id.localeCompare(b.id),
            )
            .slice(0, limit ?? 20),
    )
    apiMocks.getCommsClient.mockResolvedValue({
        threads: {
            getThreads: mockGetThreads,
            getUnread: vi.fn().mockResolvedValue({ data: unread, version: 1 }),
        },
    })
    return { mockGetThreads }
}

// One thread a minute, newest first, ending at 2026-10-31T00:00:00Z.
function minutelyThreads(count: number): Thread[] {
    const newest = Date.parse('2026-10-31T00:00:00Z')
    return Array.from({ length: count }, (_, i) =>
        createThread(`T${String(i).padStart(4, '0')}`, {
            lastUpdated: new Date(newest - i * 60_000),
        }),
    )
}

const idsOf = (threads: Thread[]) => threads.map((t) => t.id)

const cursorAfter = (thread: Thread) =>
    encodeCursor({ before: thread.lastUpdated.getTime(), shown: [thread.id] })

async function listThreads(args: string[]): Promise<{ ids: string[]; nextCursor: string | null }> {
    const consoleSpy = captureConsole('log')
    await createProgram().parseAsync([
        'node',
        'tdc',
        'channel',
        'threads',
        '12345',
        '--json',
        ...args,
    ])
    const output = JSON.parse(consoleSpy.mock.lastCall?.[0])
    return { ids: idsOf(output.results), nextCursor: output.nextCursor }
}

describe('channel threads paging', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCurrentWorkspaceId.mockResolvedValue(1)
        refsMocks.resolveChannelRef.mockResolvedValue(channel())
    })

    it('lists every thread in a --since window, not just the newest 20', async () => {
        const threads = minutelyThreads(30)
        setupBackend(threads)

        const { ids, nextCursor } = await listThreads([
            '--since',
            '2026-10-30T23:37:00Z',
            '--limit',
            '200',
        ])

        expect(ids).toEqual(idsOf(threads.slice(0, 24)))
        expect(nextCursor).toBeNull()
    })

    it('passes --since and --until to the API', async () => {
        const { mockGetThreads } = setupBackend(minutelyThreads(5))

        await listThreads(['--since', '2026-10-01', '--until', '2026-10-31T00:00:00.250Z'])

        expect(mockGetThreads).toHaveBeenCalledWith({
            workspaceId: 1,
            channelId: 'CH100',
            archived: false,
            newerThan: new Date('2026-10-01T00:00:00Z'),
            // Rounded up, because the API compares whole seconds and --until is exclusive.
            olderThan: new Date('2026-10-31T00:00:01Z'),
            limit: 51,
        })
    })

    it('keeps the --since and --until window on every call past the first', async () => {
        const threads = minutelyThreads(1200)
        const since = threads[899].lastUpdated.getTime()
        const until = threads[99].lastUpdated.getTime()
        const { mockGetThreads } = setupBackend(threads)

        const { ids, nextCursor } = await listThreads([
            '--since',
            new Date(since).toISOString(),
            '--until',
            new Date(until).toISOString(),
            '--limit',
            '1000',
        ])

        expect(ids).toEqual(idsOf(threads.slice(100, 900)))
        expect(nextCursor).toBeNull()
        expect(mockGetThreads.mock.calls.length).toBeGreaterThan(1)
        for (const [call] of mockGetThreads.mock.calls) {
            expect(call.newerThan).toEqual(new Date(since))
            expect(call.olderThan?.getTime()).toBeLessThanOrEqual(until)
        }
    })

    it('fills the default --limit of 50 from a single call', async () => {
        const threads = minutelyThreads(80)
        const { mockGetThreads } = setupBackend(threads)

        const { ids, nextCursor } = await listThreads([])

        expect(ids).toEqual(idsOf(threads.slice(0, 50)))
        expect(nextCursor).toEqual(cursorAfter(threads[49]))
        expect(mockGetThreads).toHaveBeenCalledTimes(1)
    })

    it('keeps calling past 500 threads to fill a larger page', async () => {
        const threads = minutelyThreads(700)
        const { mockGetThreads } = setupBackend(threads)

        const { ids, nextCursor } = await listThreads(['--limit', '600'])

        expect(ids).toEqual(idsOf(threads.slice(0, 600)))
        expect(nextCursor).toEqual(cursorAfter(threads[599]))
        expect(mockGetThreads).toHaveBeenCalledTimes(2)
    })

    it('walks the channel through nextCursor with one call per page', async () => {
        const threads = minutelyThreads(700)
        const { mockGetThreads } = setupBackend(threads)

        const walked: string[] = []
        let cursor: string | null = null
        do {
            const page = await listThreads([
                '--limit',
                '100',
                ...(cursor ? ['--cursor', cursor] : []),
            ])
            walked.push(...page.ids)
            cursor = page.nextCursor
        } while (cursor)

        expect(walked).toEqual(idsOf(threads))
        expect(mockGetThreads).toHaveBeenCalledTimes(7)
    })

    it('carries threads from one second across page breaks', async () => {
        const threads = minutelyThreads(10)
        for (let i = 2; i < 8; i++) {
            threads[i].lastUpdated = new Date(threads[2].lastUpdated)
        }
        setupBackend(threads)

        const walked: string[] = []
        let cursor: string | null = null
        do {
            const page = await listThreads([
                '--limit',
                '3',
                ...(cursor ? ['--cursor', cursor] : []),
            ])
            walked.push(...page.ids)
            cursor = page.nextCursor
        } while (cursor)

        expect(walked).toEqual(idsOf(threads))
    })

    it('skips the threads a second call returns again from the same second', async () => {
        const threads = minutelyThreads(600)
        for (let i = 495; i < 510; i++) {
            threads[i].lastUpdated = new Date(threads[495].lastUpdated)
        }
        setupBackend(threads)

        const { ids } = await listThreads(['--limit', '600'])

        expect(ids).toEqual(idsOf(threads))
    })

    it('walks threads with millisecond times inside one second exactly once', async () => {
        const threads = minutelyThreads(10)
        const second = threads[2].lastUpdated.getTime()
        for (let i = 2; i < 8; i++) {
            threads[i].lastUpdated = new Date(second + 900 - (i - 2) * 150)
        }
        setupBackend(threads)

        const walked: string[] = []
        let cursor: string | null = null
        do {
            const page = await listThreads([
                '--limit',
                '2',
                ...(cursor ? ['--cursor', cursor] : []),
            ])
            walked.push(...page.ids)
            cursor = page.nextCursor
        } while (cursor)

        expect(walked).toEqual(idsOf(threads))
    })

    it('fails rather than leave threads out when more than a call shares one second', async () => {
        const threads = minutelyThreads(600)
        for (const thread of threads) thread.lastUpdated = new Date(threads[0].lastUpdated)
        setupBackend(threads)

        await expect(listThreads(['--limit', '600'])).rejects.toHaveProperty(
            'code',
            'PAGINATION_STALLED',
        )
    })

    it('--unread stops once it has found the unread threads in this channel', async () => {
        const threads = minutelyThreads(1200)
        const { mockGetThreads } = setupBackend(threads, [
            { threadId: threads[700].id, channelId: 'CH100' },
            { threadId: 'in-another-channel', channelId: 'CH200' },
        ])

        const { ids } = await listThreads(['--unread'])

        expect(ids).toEqual([threads[700].id])
        // A one-thread call (one thread is unread here), then 500 at a time until it turns up.
        expect(mockGetThreads).toHaveBeenCalledTimes(3)
    })

    it('--unread skips the thread calls when nothing in this channel is unread', async () => {
        const { mockGetThreads } = setupBackend(minutelyThreads(10), [
            { threadId: 'in-another-channel', channelId: 'CH200' },
        ])

        const { ids } = await listThreads(['--unread'])

        expect(ids).toEqual([])
        expect(mockGetThreads).not.toHaveBeenCalled()
    })

    it('--unread pages after the first also stop at the last unread thread', async () => {
        const threads = minutelyThreads(1200)
        const { mockGetThreads } = setupBackend(
            threads,
            threads.slice(0, 150).map((t) => ({ threadId: t.id, channelId: 'CH100' })),
        )

        const pages: string[][] = []
        let cursor: string | null = null
        do {
            mockGetThreads.mockClear()
            const page = await listThreads(['--unread', ...(cursor ? ['--cursor', cursor] : [])])
            pages.push(page.ids)
            cursor = page.nextCursor
            // Every page stops at the last unread thread instead of reading the 1,050 after it.
            expect(mockGetThreads).toHaveBeenCalledTimes(1)
        } while (cursor)

        expect(pages).toEqual([
            idsOf(threads.slice(0, 50)),
            idsOf(threads.slice(50, 100)),
            idsOf(threads.slice(100, 150)),
        ])
    })

    it('--unread reads on when the unread threads change between pages', async () => {
        const threads = minutelyThreads(1200)
        const unread = threads.slice(0, 51).map((t) => ({ threadId: t.id, channelId: 'CH100' }))
        setupBackend(threads, unread)

        const first = await listThreads(['--unread'])
        // A thread from the first page gets read and an older one turns unread, so the
        // channel still has 51 unread threads, just not the same ones.
        unread[0] = { threadId: threads[700].id, channelId: 'CH100' }
        const second = await listThreads(['--unread', '--cursor', first.nextCursor as string])

        expect(first.ids).toEqual(idsOf(threads.slice(0, 50)))
        expect(second.ids).toEqual([threads[50].id, threads[700].id])
        expect(second.nextCursor).toBeNull()
    })
})

describe('cursor helpers', () => {
    const encodeRaw = (payload: unknown) =>
        Buffer.from(JSON.stringify(payload)).toString('base64url')

    it('encodes and decodes a cursor round-trip', () => {
        const cursor = { before: Date.parse('2026-10-31T00:00:00Z'), shown: ['T1', 'T2'] }
        expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
    })

    it('decodeCursor(undefined) returns undefined', () => {
        expect(decodeCursor(undefined)).toBeUndefined()
    })

    it('throws INVALID_CURSOR on non-base64 input', () => {
        expect(() => decodeCursor('!!!nope!!!')).toThrowError(
            expect.objectContaining({ code: 'INVALID_CURSOR' }),
        )
    })

    it('throws INVALID_CURSOR when payload has no before field', () => {
        expect(() => decodeCursor(encodeRaw({ shown: [] }))).toThrowError(
            expect.objectContaining({ code: 'INVALID_CURSOR' }),
        )
    })

    it('throws INVALID_CURSOR when before is negative', () => {
        expect(() => decodeCursor(encodeRaw({ before: -1, shown: [] }))).toThrowError(
            expect.objectContaining({ code: 'INVALID_CURSOR' }),
        )
    })

    it('throws INVALID_CURSOR when shown is not a list of ids', () => {
        expect(() => decodeCursor(encodeRaw({ before: 1, shown: [1] }))).toThrowError(
            expect.objectContaining({ code: 'INVALID_CURSOR' }),
        )
    })

    it('round-trips the count of unread threads still to come', () => {
        const cursor = { before: 1000, shown: ['T1'], unreadLeft: 3, unreadSet: 'abc' }
        expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
    })

    it('throws INVALID_CURSOR when unreadLeft is not a whole number', () => {
        expect(() =>
            decodeCursor(encodeRaw({ before: 1, shown: [], unreadLeft: -1 })),
        ).toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR' }))
        expect(() =>
            decodeCursor(encodeRaw({ before: 1, shown: [], unreadLeft: 1.5 })),
        ).toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR' }))
    })

    it('throws INVALID_CURSOR for an offset cursor from older versions', () => {
        expect(() => decodeCursor(encodeRaw({ offset: 50 }))).toThrowError(
            expect.objectContaining({ code: 'INVALID_CURSOR' }),
        )
    })
})

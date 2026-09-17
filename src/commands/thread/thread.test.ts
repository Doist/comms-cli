import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { CommsApi, type CustomFetch, generateId } from '@doist/comms-sdk'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
}))

const configMocks = vi.hoisted(() => ({
    getConfig: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../lib/config.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/config.js')>()),
    getConfig: configMocks.getConfig,
}))

vi.mock('../../lib/public-channels.js', () => ({
    assertChannelIsPublic: vi.fn(),
}))

const groupsMock = vi.hoisted(() => ({
    getWorkspaceGroups: vi.fn().mockResolvedValue([]),
    getWorkspaceUsers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../lib/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/api.js')>()),
    getCommsClient: apiMocks.getCommsClient,
    getWorkspaceGroups: groupsMock.getWorkspaceGroups,
    getWorkspaceUsers: groupsMock.getWorkspaceUsers,
}))

vi.mock('../../lib/markdown.js', () => ({
    renderMarkdown: vi.fn((text: string) => Promise.resolve(text)),
}))

vi.mock('../../lib/input.js', () => ({
    readStdin: vi.fn().mockResolvedValue(''),
    readStdinToEnd: vi.fn().mockResolvedValue(''),
    openEditor: vi.fn().mockResolvedValue(''),
}))

vi.mock('chalk')

import { clearWorkspaceUserCache } from '../../lib/api.js'
import { openEditor, readStdin, readStdinToEnd } from '../../lib/input.js'
import { registerThreadCommand } from './index.js'

function createThreadFixture(id: number | string) {
    const sid = String(id)
    return {
        id: sid,
        title: 'Test Thread',
        content: 'Thread body',
        creator: 1,
        channelId: 'CH100',
        workspaceId: 10,
        posted: new Date('2026-03-01T00:00:00.000Z'),
        lastUpdated: new Date('2026-03-02T00:00:00.000Z'),
        commentCount: 3,
        lastObjIndex: 3 as number | null,
        lastComment: null as ReturnType<typeof createComment> | null,
        isArchived: false,
        reactions: [],
        url: `https://comms.todoist.com/a/10/ch/CH100/t/${sid}`,
    }
}

function createComment(id: number | string, objIndex: number) {
    const sid = String(id)
    return {
        id: sid,
        content: `Comment ${sid}`,
        creator: 2,
        threadId: '500',
        channelId: 'CH100',
        workspaceId: 10,
        posted: new Date('2026-03-02T00:00:00.000Z'),
        reactions: [],
        objIndex,
        url: `https://comms.todoist.com/a/10/ch/CH100/t/500/c/${sid}`,
    }
}

function createClient({
    thread = createThreadFixture(500),
    comments = [] as ReturnType<typeof createComment>[],
    unreadThreads = [] as Array<{
        threadId: string
        channelId: string
        objIndex: number
        directMention: boolean
    }>,
    users = {} as Record<number, { id: number; fullName: string }>,
    channel = { id: 'CH100', name: 'General', workspaceId: 10 },
    sessionUser = { id: 1, fullName: 'Test User' },
} = {}) {
    let unreadState = [...unreadThreads]

    return {
        threads: {
            getThread: vi.fn(async (_id: string) => thread),
            getUnread: vi.fn(async () => ({ data: unreadState, version: 1 })),
            createThread: vi.fn(
                async (_args: {
                    channelId: string
                    content: string
                    title?: string | null
                    attachments?: Array<{ fileName?: string | null }>
                }) => createThreadFixture(999),
            ),
            closeThread: vi.fn(async (_args: { id: string; content: string }) =>
                createComment(10, 10),
            ),
            reopenThread: vi.fn(async (_args: { id: string; content: string }) =>
                createComment(11, 11),
            ),
            markRead: vi.fn(async ({ id }: { id: string; objIndex: number }) => {
                unreadState = unreadState.filter((unread) => unread.threadId !== id)
            }),
            markUnread: vi.fn(async ({ id, objIndex }: { id: string; objIndex: number }) => {
                unreadState = [
                    ...unreadState.filter((unread) => unread.threadId !== id),
                    { threadId: id, channelId: 'CH100', objIndex, directMention: false },
                ]
            }),
            muteThread: vi.fn(async (_args: { id: string; minutes: number }) => ({
                ...thread,
                mutedUntil: new Date(Date.now() + _args.minutes * 60000),
            })),
            unmuteThread: vi.fn(async (_id: string) => ({
                ...thread,
                mutedUntil: null,
            })),
            deleteThread: vi.fn(async () => undefined),
            updateThread: vi.fn(
                async (_args: { id: string; title?: string | null; content?: string | null }) => ({
                    ...thread,
                    title: _args.title ?? thread.title,
                    content: _args.content ?? thread.content,
                }),
            ),
        },
        users: {
            getSessionUser: vi.fn(async () => sessionUser),
        },
        comments: {
            getComments: vi.fn(async (_args: unknown) => comments),
            getComment: vi.fn(
                async (id: string) => comments.find((c) => c.id === id) ?? comments[0],
            ),
            createComment: vi.fn(
                async (_args: {
                    threadId: string
                    content: string
                    attachments?: Array<{ fileName?: string | null }>
                }) => createComment(12, 12),
            ),
        },
        attachments: {
            upload: vi.fn(async (args: { file: Blob; fileName: string }) => ({
                attachmentId: `att-${args.fileName}`,
                urlType: 'file',
                fileName: args.fileName,
            })),
        },
        channels: {
            getChannel: vi.fn(async (_id: string) => channel),
        },
        inbox: {
            archiveThread: vi.fn(async () => undefined),
            unarchiveThread: vi.fn(async () => undefined),
        },
        workspaceUsers: {
            getUserById: vi.fn(
                async ({ userId }: { workspaceId: number; userId: number }) => users[userId],
            ),
            getWorkspaceUsers: vi.fn(async () => Object.values(users)),
        },
    }
}

const createProgram = () => createTestProgram(registerThreadCommand)

// Shared setup for the --file suites: a fresh mock client wired into getCommsClient
// plus a program. Tests asserting on output call captureConsole('log') themselves.
function setupFileTest() {
    const client = createClient()
    apiMocks.getCommsClient.mockResolvedValue(client)
    return { client, program: createProgram() }
}

// Registers a temp dir with two files for a --file suite, cleaned up afterwards.
function useFileFixtures(prefix: string, png: string, pdf: string) {
    const paths = { dir: '', png: '', pdf: '' }
    beforeAll(async () => {
        paths.dir = await mkdtemp(join(tmpdir(), prefix))
        paths.png = join(paths.dir, png)
        paths.pdf = join(paths.dir, pdf)
        await writeFile(paths.png, 'png-bytes')
        await writeFile(paths.pdf, 'pdf-bytes')
    })
    afterAll(async () => {
        await rm(paths.dir, { recursive: true, force: true })
    })
    return paths
}

describe('thread implicit view', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
        apiMocks.getCommsClient.mockRejectedValue(new Error('MOCK_API_REACHED'))
    })

    it('tdc thread <ref> routes to view (not unknown command)', async () => {
        const program = createProgram()
        captureConsole('log')

        // If Commander routes to view, it will call getCommsClient which throws MOCK_API_REACHED.
        // If it doesn't route, Commander throws "unknown command '100'".
        await expect(program.parseAsync(['node', 'tdc', 'thread', '100'])).rejects.toThrow(
            'MOCK_API_REACHED',
        )
    })

    it('accepts id: prefixes in --notify for thread reply', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        groupsMock.getWorkspaceGroups.mockResolvedValue([])

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '100',
            'hello',
            '--notify',
            'id:123,456',
            '--dry-run',
        ])

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Would post comment to thread'),
        )
    })

    it('--close dry-run indicates thread will be closed', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        groupsMock.getWorkspaceGroups.mockResolvedValue([])

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '100',
            'closing this',
            '--close',
            '--dry-run',
        ])

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Would post comment to thread and close it'),
        )
    })

    it('--reopen dry-run indicates thread will be reopened', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        groupsMock.getWorkspaceGroups.mockResolvedValue([])

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '100',
            'reopening this',
            '--reopen',
            '--dry-run',
        ])

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Would post comment to thread and reopen it'),
        )
    })

    it('--close calls closeThread instead of createComment', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        vi.mocked(readStdin).mockResolvedValueOnce('closing comment')
        await program.parseAsync(['node', 'tdc', 'thread', 'reply', '500', '--close'])

        expect(client.threads.closeThread).toHaveBeenCalledWith(
            expect.objectContaining({ id: '500', content: 'closing comment' }),
        )
        expect(client.comments.createComment).not.toHaveBeenCalled()
    })

    it('--reopen calls reopenThread instead of createComment', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        vi.mocked(readStdin).mockResolvedValueOnce('reopening comment')
        await program.parseAsync(['node', 'tdc', 'thread', 'reply', '500', '--reopen'])

        expect(client.threads.reopenThread).toHaveBeenCalledWith(
            expect.objectContaining({ id: '500', content: 'reopening comment' }),
        )
        expect(client.comments.createComment).not.toHaveBeenCalled()
    })

    it('--close and --reopen together produces an error', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'thread',
                'reply',
                '100',
                'content',
                '--close',
                '--reopen',
            ]),
        ).rejects.toHaveProperty('code', 'CONFLICTING_OPTIONS')
    })
})

describe.each(['reply', 'close', 'reopen'] as const)('thread %s notifications', (action) => {
    const actionArgs = action === 'reply' ? [] : [`--${action}`]
    const idField = action === 'reply' ? 'threadId' : 'id'
    const commentMutation = (client: ReturnType<typeof createClient>) =>
        action === 'close'
            ? client.threads.closeThread
            : action === 'reopen'
              ? client.threads.reopenThread
              : client.comments.createComment

    beforeEach(() => {
        vi.clearAllMocks()
        groupsMock.getWorkspaceGroups.mockResolvedValue([])
        groupsMock.getWorkspaceUsers.mockResolvedValue([])
    })

    it('posts with explicitly empty notification fields for --notify NONE', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '500',
            'Quiet update',
            '--notify',
            'NONE',
            ...actionArgs,
        ])

        expect(commentMutation(client)).toHaveBeenCalledExactlyOnceWith({
            [idField]: '500',
            content: 'Quiet update',
            recipients: [],
            groups: [],
            directMentions: [],
            directGroupMentions: [],
        })
    })

    it('preserves empty notification arrays through SDK serialization', async () => {
        const threadId = generateId()
        const comment = {
            id: generateId(),
            thread_id: threadId,
            channel_id: generateId(),
            workspace_id: 10,
            content: 'Quiet update',
            creator: 2,
            posted_ts: 1772409600,
        }
        const customFetch = vi.fn<CustomFetch>().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: {},
            text: async () => JSON.stringify(comment),
            json: async () => comment,
        })
        const client = new CommsApi('test-token', { customFetch })
        vi.spyOn(client.threads, 'getThread').mockResolvedValue({
            ...createThreadFixture(threadId),
            snippet: 'Thread body',
            snippetCreator: 1,
            reactions: {},
            lastComment: null,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)
        captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            threadId,
            'Quiet update',
            '--notify',
            'NONE',
            ...actionArgs,
        ])

        expect(customFetch).toHaveBeenCalledOnce()
        const [url, request] = customFetch.mock.calls[0]
        expect(url).toMatch(/\/comments\/add$/)
        expect(request?.method).toBe('POST')
        expect(JSON.parse(String(request?.body))).toEqual({
            id: expect.any(String),
            thread_id: threadId,
            content: 'Quiet update',
            recipients: [],
            groups: [],
            direct_mentions: [],
            direct_group_mentions: [],
            ...(action === 'reply' ? {} : { thread_action: action }),
        })
    })

    it.each([
        { notify: undefined, expected: { recipients: 'EVERYONE_IN_THREAD' } },
        { notify: 'EVERYONE_IN_THREAD', expected: { recipients: 'EVERYONE_IN_THREAD' } },
        { notify: 'EVERYONE', expected: { recipients: 'EVERYONE' } },
        { notify: 'id:123,456', expected: { recipients: [123, 456] } },
        { notify: 'group1', expected: { recipients: undefined, groups: ['group1'] } },
        { notify: '123,id:group1', expected: { recipients: [123], groups: ['group1'] } },
    ])('preserves existing recipients for $notify', async ({ notify, expected }) => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        groupsMock.getWorkspaceGroups.mockResolvedValue([{ id: 'group1', name: 'Team' }])
        captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '500',
            'Update',
            ...(notify ? ['--notify', notify] : []),
            ...actionArgs,
        ])

        expect(commentMutation(client)).toHaveBeenCalledExactlyOnceWith({
            [idField]: '500',
            content: 'Update',
            ...expected,
        })
    })

    it('shows NONE in the dry-run preview without posting', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const consoleSpy = captureConsole('log')

        await createProgram().parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '500',
            'Quiet update',
            '--notify',
            'NONE',
            '--dry-run',
            ...actionArgs,
        ])

        const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n')
        expect(output).toContain('Notify: NONE')
        expect(output).toContain(
            `Would post comment to thread${action === 'reply' ? '' : ` and ${action} it`}`,
        )
        expect(client.comments.createComment).not.toHaveBeenCalled()
        expect(client.threads.closeThread).not.toHaveBeenCalled()
        expect(client.threads.reopenThread).not.toHaveBeenCalled()
    })
})

describe('thread view --unread', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
        configMocks.getConfig.mockResolvedValue({})
        groupsMock.getWorkspaceGroups.mockResolvedValue([])
        groupsMock.getWorkspaceUsers.mockResolvedValue([])
    })

    it('shows original post and "No unread comments" when thread has no unread data', async () => {
        const client = createClient({
            comments: [createComment(1, 1), createComment(2, 2)],
            unreadThreads: [],
            users: { 1: { id: 1, fullName: 'Alice' }, 2: { id: 2, fullName: 'Bob' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'view', '500', '--unread'])

        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('Test Thread')
        expect(output).toContain('Thread body')
        expect(output).toContain('No unread comments.')
    })

    it('filters to only unread comments in human-readable output', async () => {
        const client = createClient({
            comments: [createComment(1, 1), createComment(2, 2), createComment(3, 3)],
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
            users: { 1: { id: 1, fullName: 'Alice' }, 2: { id: 2, fullName: 'Bob' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'view', '500', '--unread'])

        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        // Should show original post
        expect(output).toContain('Thread body')
        // Should show unread comments (objIndex 2 and 3, which are > 1)
        expect(output).toContain('Comment 2')
        expect(output).toContain('Comment 3')
        // Should NOT show comment 1 (objIndex 1, which is <= lastReadObjIndex 1)
        expect(output).not.toContain('Comment 1')
        // Should show unread separator
        expect(output).toContain('UNREAD (2 new)')
    })

    it('filters comments in --json output when --unread is set', async () => {
        const client = createClient({
            comments: [createComment(1, 1), createComment(2, 2), createComment(3, 3)],
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 2, directMention: false },
            ],
            users: { 1: { id: 1, fullName: 'Alice' }, 2: { id: 2, fullName: 'Bob' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'view', '500', '--unread', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.thread.id).toBe('500')
        // Only comment 3 is unread (objIndex 3 > lastReadObjIndex 2)
        expect(jsonOutput.comments).toHaveLength(1)
        expect(jsonOutput.comments[0].id).toBe('3')
    })

    it('returns empty comments in --json output when no unread data exists', async () => {
        const client = createClient({
            comments: [createComment(1, 1), createComment(2, 2)],
            unreadThreads: [],
            users: { 1: { id: 1, fullName: 'Alice' }, 2: { id: 2, fullName: 'Bob' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'view', '500', '--unread', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.thread.id).toBe('500')
        expect(jsonOutput.comments).toHaveLength(0)
    })

    it('filters comments in --ndjson output when --unread is set', async () => {
        const client = createClient({
            comments: [createComment(1, 1), createComment(2, 2), createComment(3, 3)],
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
            users: { 1: { id: 1, fullName: 'Alice' }, 2: { id: 2, fullName: 'Bob' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'view', '500', '--unread', '--ndjson'])

        const lines = consoleSpy.mock.calls.map((c) => JSON.parse(c[0]))
        // First line is the thread
        expect(lines[0].type).toBe('thread')
        // Only unread comments (objIndex > 1)
        const commentLines = lines.filter((l) => l.type === 'comment')
        expect(commentLines).toHaveLength(2)
        expect(commentLines[0].id).toBe('2')
        expect(commentLines[1].id).toBe('3')
    })

    it('returns all comments in --json without --unread', async () => {
        const client = createClient({
            comments: [createComment(1, 1), createComment(2, 2)],
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
            users: { 1: { id: 1, fullName: 'Alice' }, 2: { id: 2, fullName: 'Bob' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'view', '500', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        // Without --unread, all comments are returned
        expect(jsonOutput.comments).toHaveLength(2)
        // getUnread should not be called
        expect(client.threads.getUnread).not.toHaveBeenCalled()
    })
})

describe('thread view date filters', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
        configMocks.getConfig.mockResolvedValue({})
        groupsMock.getWorkspaceGroups.mockResolvedValue([])
        groupsMock.getWorkspaceUsers.mockResolvedValue([])
    })

    it('maps --since to newerThan for getComments', async () => {
        const client = createClient({
            comments: [createComment(1, 1)],
            users: { 1: { id: 1, fullName: 'Alice' }, 2: { id: 2, fullName: 'Bob' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'view',
            '500',
            '--since',
            '2026-01-01',
            '--json',
        ])

        expect(client.comments.getComments).toHaveBeenCalledWith(
            expect.objectContaining({
                threadId: '500',
                newerThan: new Date('2026-01-01'),
            }),
        )
        const [args] = client.comments.getComments.mock.calls[0] as [Record<string, unknown>]
        expect(args).not.toHaveProperty('from')
    })

    it('maps --until to olderThan for getComments', async () => {
        const client = createClient({
            comments: [createComment(1, 1)],
            users: { 1: { id: 1, fullName: 'Alice' }, 2: { id: 2, fullName: 'Bob' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'view',
            '500',
            '--until',
            '2026-01-31',
            '--json',
        ])

        expect(client.comments.getComments).toHaveBeenCalledWith(
            expect.objectContaining({
                threadId: '500',
                olderThan: new Date('2026-01-31'),
            }),
        )
    })
})

describe('thread view error propagation', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
        configMocks.getConfig.mockResolvedValue({})
        groupsMock.getWorkspaceGroups.mockResolvedValue([])
        groupsMock.getWorkspaceUsers.mockResolvedValue([])
    })

    it('surfaces the API error when fetching a missing comment', async () => {
        const client = createClient({
            users: { 1: { id: 1, fullName: 'Alice' } },
        })
        client.comments.getComment.mockRejectedValueOnce(new Error('Comment not found'))
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'view', '500', '--comment', '99999']),
        ).rejects.toThrow('Comment not found')
    })

    it('surfaces the API error when fetching a missing thread', async () => {
        const client = createClient()
        client.threads.getThread.mockRejectedValueOnce(new Error('Thread not found'))
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await expect(program.parseAsync(['node', 'tdc', 'thread', 'view', '500'])).rejects.toThrow(
            'Thread not found',
        )
    })

    it('renders the thread when a user is missing from the workspace map', async () => {
        const comments = [createComment(1, 1), createComment(2, 2)]
        const client = createClient({
            comments,
            // Only user 1 in workspace; comment 2's creator (user 2) won't resolve to a name
            users: { 1: { id: 1, fullName: 'Alice' } },
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'view', '500'])

        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('Alice')
        expect(output).toContain('user:2')
    })
})

describe('thread create', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
        configMocks.getConfig.mockResolvedValue({})
    })

    it('creates a thread with positional title and content', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            '100',
            'My Title',
            'Thread body content',
        ])

        expect(client.threads.createThread).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: '100',
                title: 'My Title',
                content: 'Thread body content',
            }),
        )
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Thread created:'))
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            '100',
            'Test Title',
            'Dry run content',
            '--dry-run',
        ])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would create thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Title: Test Title')
        expect(consoleSpy).toHaveBeenCalledWith('  Content: Dry run content')
    })

    it('outputs JSON with --json', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            '100',
            'Title',
            'Thread body',
            '--json',
        ])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe('999')
        expect(jsonOutput.channelId).toBe('CH100')
    })

    it('reads content from stdin', async () => {
        vi.mocked(readStdin).mockResolvedValueOnce('Content from stdin')
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'create', '100', 'My Title'])

        expect(client.threads.createThread).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: '100',
                title: 'My Title',
                content: 'Content from stdin',
            }),
        )
    })

    it('passes notify recipients (users only)', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        groupsMock.getWorkspaceGroups.mockResolvedValue([])
        groupsMock.getWorkspaceUsers.mockResolvedValue([
            { id: 123, fullName: 'Alice' },
            { id: 456, fullName: 'Bob' },
        ])

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            '100',
            'Title',
            'Thread body',
            '--notify',
            '123,456',
        ])

        expect(client.threads.createThread).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: '100',
                content: 'Thread body',
                recipients: [123, 456],
            }),
        )
    })

    it('partitions notify IDs into users and groups', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        groupsMock.getWorkspaceGroups.mockResolvedValue([
            { id: 'GR456', name: 'Frontend', workspaceId: 10, userIds: [1, 2], version: 1 },
        ])
        groupsMock.getWorkspaceUsers.mockResolvedValue([{ id: 123, fullName: 'Alice' }])

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            '100',
            'Title',
            'Thread body',
            '--notify',
            '123,GR456',
        ])

        expect(client.threads.createThread).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: '100',
                content: 'Thread body',
                recipients: [123],
                groups: ['GR456'],
            }),
        )
    })

    it('errors when no content is provided', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'create', '100', 'My Title']),
        ).rejects.toHaveProperty('code', 'MISSING_CONTENT')
    })

    it('does not unarchive by default', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'create', '100', 'T', 'body'])

        expect(client.inbox.unarchiveThread).not.toHaveBeenCalled()
    })

    it('unarchives the new thread when --unarchive is passed', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            '100',
            'T',
            'body',
            '--unarchive',
        ])

        expect(client.inbox.unarchiveThread).toHaveBeenCalledWith('999')
    })

    it('unarchives when userSettings.unarchiveNewThreads is true', async () => {
        configMocks.getConfig.mockResolvedValueOnce({
            userSettings: { unarchiveNewThreads: true },
        })
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'create', '100', 'T', 'body'])

        expect(client.inbox.unarchiveThread).toHaveBeenCalledWith('999')
    })

    it('--no-unarchive overrides config default of true', async () => {
        configMocks.getConfig.mockResolvedValueOnce({
            userSettings: { unarchiveNewThreads: true },
        })
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            '100',
            'T',
            'body',
            '--no-unarchive',
        ])

        expect(client.inbox.unarchiveThread).not.toHaveBeenCalled()
    })

    it('unarchive failure does not fail the command', async () => {
        const client = createClient()
        client.inbox.unarchiveThread.mockRejectedValueOnce(new Error('boom'))
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')
        const errorSpy = captureConsole('error')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            '100',
            'T',
            'body',
            '--unarchive',
        ])

        expect(client.threads.createThread).toHaveBeenCalled()
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('failed to unarchive'))
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Thread created:'))
    })
})

describe('thread mute', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('mutes a thread with default 60 minutes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mute', '500'])

        expect(client.threads.muteThread).toHaveBeenCalledWith({ id: '500', minutes: 60 })
        expect(consoleSpy).toHaveBeenCalledWith('Thread 500 muted for 60 minutes.')
    })

    it('mutes a thread with custom minutes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mute', '500', '--minutes', '480'])

        expect(client.threads.muteThread).toHaveBeenCalledWith({ id: '500', minutes: 480 })
        expect(consoleSpy).toHaveBeenCalledWith('Thread 500 muted for 480 minutes.')
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mute', '500', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would mute thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: Test Thread (500)')
        expect(consoleSpy).toHaveBeenCalledWith('  Duration: 60 minutes')
        expect(client.threads.muteThread).not.toHaveBeenCalled()
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        client.threads.getThread.mockRejectedValueOnce(new Error('thread not found'))

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mute', '500', '--dry-run']),
        ).rejects.toThrow('thread not found')
        expect(client.threads.muteThread).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json including id and mutedUntil', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mute', '500', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe('500')
        expect(jsonOutput.mutedUntil).toBeDefined()
        expect(Object.keys(jsonOutput)).toEqual(['id', 'mutedUntil'])
    })

    it('rejects non-integer --minutes value', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mute', '500', '--minutes', 'foo']),
        ).rejects.toHaveProperty('code', 'INVALID_MINUTES')
    })
})

describe('thread unmute', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('unmutes a thread', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'unmute', '500'])

        expect(client.threads.unmuteThread).toHaveBeenCalledWith('500')
        expect(consoleSpy).toHaveBeenCalledWith('Thread 500 unmuted.')
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'unmute', '500', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would unmute thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: Test Thread (500)')
        expect(client.threads.unmuteThread).not.toHaveBeenCalled()
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        client.threads.getThread.mockRejectedValueOnce(new Error('thread not found'))

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'unmute', '500', '--dry-run']),
        ).rejects.toThrow('thread not found')
        expect(client.threads.unmuteThread).not.toHaveBeenCalled()
    })
})

describe('thread read', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
        vi.mocked(readStdinToEnd).mockResolvedValue('')
    })

    it('marks a single unread thread read without requiring --yes', async () => {
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500'])

        expect(client.threads.markRead).toHaveBeenCalledWith({ id: '500', objIndex: 3 })
        expect(consoleSpy).toHaveBeenCalledWith('Thread Test Thread (500) marked read.')
    })

    it('uses the highest available object index', async () => {
        const client = createClient({
            thread: {
                ...createThreadFixture(500),
                lastComment: createComment(10, 9),
                lastObjIndex: 12,
                commentCount: 7,
            },
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500'])

        expect(client.threads.markRead).toHaveBeenCalledWith({ id: '500', objIndex: 12 })
    })

    it('leaves already-read threads unchanged', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500'])

        expect(client.threads.markRead).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith('Thread Test Thread (500) is already read.')
    })

    it('shows dry run output', async () => {
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(
            'Dry run: would mark read thread Test Thread (500).',
        )
        expect(client.threads.markRead).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json', async () => {
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual([{ id: '500', isRead: true }])
    })

    it('emits the planned statuses with --json --dry-run', async () => {
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'mark-read',
            '500',
            '--json',
            '--dry-run',
        ])

        expect(client.threads.markRead).not.toHaveBeenCalled()
        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual([{ id: '500', isRead: true, dryRun: true }])
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        client.threads.getThread.mockRejectedValueOnce(new Error('thread not found'))

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500', '--dry-run']),
        ).rejects.toThrow('thread not found')
        expect(client.threads.markRead).not.toHaveBeenCalled()
    })

    it('surfaces markRead failures through the shared error path', async () => {
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        client.threads.markRead.mockRejectedValueOnce(new Error('mark failed'))
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500']),
        ).rejects.toThrow('mark failed')
    })

    it('previews bulk mark-read unless --yes is passed', async () => {
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500', '501'])

        expect(client.threads.markRead).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith('Would mark read thread Test Thread (500).')
        expect(consoleSpy).toHaveBeenCalledWith('Use --yes to confirm.')
    })

    it('marks every unread thread in bulk when --yes is passed', async () => {
        const thread500 = createThreadFixture(500)
        const thread501 = { ...createThreadFixture(501), title: 'Second Thread' }
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
                { threadId: '501', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        client.threads.getThread.mockImplementation(async (id: string) =>
            id === '501' ? thread501 : thread500,
        )
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500', '501', '--yes'])

        expect(client.threads.markRead).toHaveBeenCalledWith({ id: '500', objIndex: 3 })
        expect(client.threads.markRead).toHaveBeenCalledWith({ id: '501', objIndex: 3 })
        expect(client.threads.markRead).toHaveBeenCalledTimes(2)
    })

    it('requires --yes for bulk mark-read in --json mode', async () => {
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500', '501', '--json']),
        ).rejects.toHaveProperty('code', 'MISSING_YES_FLAG')
        expect(client.threads.markRead).not.toHaveBeenCalled()
    })

    it('reads thread refs from stdin', async () => {
        vi.mocked(readStdinToEnd).mockResolvedValueOnce('# comment\n500\n\n')
        const originalIsTTY = process.stdin.isTTY
        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

        try {
            const client = createClient({
                unreadThreads: [
                    { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
                ],
            })
            apiMocks.getCommsClient.mockResolvedValue(client)

            const program = createProgram()
            captureConsole('log')

            await program.parseAsync(['node', 'tdc', 'thread', 'mark-read'])

            expect(readStdinToEnd).toHaveBeenCalled()
            expect(client.threads.markRead).toHaveBeenCalledWith({ id: '500', objIndex: 3 })
        } finally {
            Object.defineProperty(process.stdin, 'isTTY', {
                value: originalIsTTY,
                configurable: true,
            })
        }
    })

    it('reads multiple thread refs from stdin', async () => {
        vi.mocked(readStdinToEnd).mockResolvedValueOnce('# comment\n500\n501\n')
        const originalIsTTY = process.stdin.isTTY
        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

        try {
            const thread500 = createThreadFixture(500)
            const thread501 = { ...createThreadFixture(501), title: 'Second Thread' }
            const client = createClient({
                unreadThreads: [
                    { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
                    { threadId: '501', channelId: 'CH100', objIndex: 1, directMention: false },
                ],
            })
            client.threads.getThread.mockImplementation(async (id: string) =>
                id === '501' ? thread501 : thread500,
            )
            apiMocks.getCommsClient.mockResolvedValue(client)

            const program = createProgram()
            captureConsole('log')

            await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '--yes'])

            expect(client.threads.markRead).toHaveBeenCalledWith({ id: '500', objIndex: 3 })
            expect(client.threads.markRead).toHaveBeenCalledWith({ id: '501', objIndex: 3 })
            expect(client.threads.markRead).toHaveBeenCalledTimes(2)
        } finally {
            Object.defineProperty(process.stdin, 'isTTY', {
                value: originalIsTTY,
                configurable: true,
            })
        }
    })

    it('combines positional and stdin thread refs', async () => {
        vi.mocked(readStdinToEnd).mockResolvedValueOnce('501\n')
        const originalIsTTY = process.stdin.isTTY
        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

        try {
            const thread500 = createThreadFixture(500)
            const thread501 = { ...createThreadFixture(501), title: 'Second Thread' }
            const client = createClient({
                unreadThreads: [
                    { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
                    { threadId: '501', channelId: 'CH100', objIndex: 1, directMention: false },
                ],
            })
            client.threads.getThread.mockImplementation(async (id: string) =>
                id === '501' ? thread501 : thread500,
            )
            apiMocks.getCommsClient.mockResolvedValue(client)

            const program = createProgram()
            captureConsole('log')

            await program.parseAsync(['node', 'tdc', 'thread', 'mark-read', '500', '--yes'])

            expect(client.threads.markRead).toHaveBeenCalledWith({ id: '500', objIndex: 3 })
            expect(client.threads.markRead).toHaveBeenCalledWith({ id: '501', objIndex: 3 })
            expect(client.threads.markRead).toHaveBeenCalledTimes(2)
        } finally {
            Object.defineProperty(process.stdin, 'isTTY', {
                value: originalIsTTY,
                configurable: true,
            })
        }
    })
})

describe('thread delete', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('deletes a thread with --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'delete', '500', '--yes'])

        expect(client.threads.deleteThread).toHaveBeenCalledWith('500')
        expect(consoleSpy).toHaveBeenCalledWith('Thread Test Thread (500) deleted.')
    })

    it('prompts for confirmation without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'delete', '500'])

        expect(consoleSpy).toHaveBeenCalledWith('Would delete: Test Thread')
        expect(consoleSpy).toHaveBeenCalledWith('Use --yes to confirm.')
        expect(client.threads.deleteThread).not.toHaveBeenCalled()
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'delete', '500', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would delete thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: Test Thread (500)')
        expect(client.threads.deleteThread).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'delete', '500', '--json', '--yes'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual({ id: '500', deleted: true })
    })

    it('errors when --json is used without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'delete', '500', '--json']),
        ).rejects.toHaveProperty('code', 'MISSING_YES_FLAG')

        expect(client.threads.deleteThread).not.toHaveBeenCalled()
    })

    it('errors when thread creator does not match session user', async () => {
        const client = createClient({ sessionUser: { id: 999, fullName: 'Other User' } })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'delete', '500', '--yes']),
        ).rejects.toHaveProperty('code', 'NOT_CREATOR')

        expect(client.threads.deleteThread).not.toHaveBeenCalled()
    })
})

describe('thread rename', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('renames a thread', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'rename', '500', 'New Title'])

        expect(client.threads.updateThread).toHaveBeenCalledWith({ id: '500', title: 'New Title' })
        expect(consoleSpy).toHaveBeenCalledWith('Thread 500 renamed to "New Title".')
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'rename',
            '500',
            'New Title',
            '--dry-run',
        ])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would rename thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: Test Thread (500)')
        expect(consoleSpy).toHaveBeenCalledWith('  New title: New Title')
        expect(client.threads.updateThread).not.toHaveBeenCalled()
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        client.threads.getThread.mockRejectedValueOnce(new Error('thread not found'))

        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'thread',
                'rename',
                '500',
                'New Title',
                '--dry-run',
            ]),
        ).rejects.toThrow('thread not found')
        expect(client.threads.updateThread).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json including id and title', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'rename', '500', 'New Title', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe('500')
        expect(jsonOutput.title).toBe('New Title')
        expect(Object.keys(jsonOutput)).toEqual(['id', 'title'])
    })

    it('outputs full JSON with --json --full', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'rename',
            '500',
            'New Title',
            '--json',
            '--full',
        ])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe('500')
        expect(jsonOutput.title).toBe('New Title')
        // Full output includes more fields
        expect(Object.keys(jsonOutput).length).toBeGreaterThan(2)
    })
})

describe('thread update', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('updates a thread body', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'update', '500', 'New body'])

        expect(client.threads.updateThread).toHaveBeenCalledWith({
            id: '500',
            content: 'New body',
        })
        expect(consoleSpy).toHaveBeenCalledWith('Thread 500 updated.')
    })

    it('shows dry run output without calling updateThread', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'update',
            '500',
            'New body',
            '--dry-run',
        ])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would update thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: Test Thread (500)')
        expect(consoleSpy).toHaveBeenCalledWith('  Content: New body')
        expect(client.threads.updateThread).not.toHaveBeenCalled()
    })

    it('reads content from stdin', async () => {
        vi.mocked(readStdin).mockResolvedValueOnce('Body from stdin')
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'update', '500'])

        expect(client.threads.updateThread).toHaveBeenCalledWith({
            id: '500',
            content: 'Body from stdin',
        })
    })

    it('errors when no content is provided', async () => {
        const program = createProgram()
        captureConsole('log')

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'update', '500']),
        ).rejects.toHaveProperty('code', 'MISSING_CONTENT')
    })

    it('outputs JSON with --json including id and content', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'update', '500', 'New body', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe('500')
        expect(jsonOutput.content).toBe('New body')
        expect(Object.keys(jsonOutput)).toEqual(['id', 'content'])
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        client.threads.getThread.mockRejectedValueOnce(new Error('thread not found'))

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'update', '500', 'New body', '--dry-run']),
        ).rejects.toThrow('thread not found')
        expect(client.threads.updateThread).not.toHaveBeenCalled()
    })
})

describe('thread done', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('archives a thread with --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'done', '500', '--yes'])

        expect(client.inbox.archiveThread).toHaveBeenCalledWith('500')
        expect(consoleSpy).toHaveBeenCalledWith('Thread 500 archived.')
    })

    it('prompts for confirmation without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'done', '500'])

        expect(consoleSpy).toHaveBeenCalledWith('Would archive: Test Thread (500)')
        expect(consoleSpy).toHaveBeenCalledWith('Use --yes to confirm.')
        expect(client.inbox.archiveThread).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'done', '500', '--json', '--yes'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual({ id: '500', isArchived: true })
    })

    it('errors when --json is used without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'done', '500', '--json']),
        ).rejects.toHaveProperty('code', 'MISSING_YES_FLAG')

        expect(client.inbox.archiveThread).not.toHaveBeenCalled()
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'done', '500', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would archive thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: Test Thread (500)')
        expect(client.inbox.archiveThread).not.toHaveBeenCalled()
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        client.threads.getThread.mockRejectedValueOnce(new Error('thread not found'))

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'done', '500', '--dry-run']),
        ).rejects.toThrow('thread not found')
        expect(client.inbox.archiveThread).not.toHaveBeenCalled()
    })
})

describe('thread undone', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('unarchives a thread with --yes', async () => {
        const client = createClient({ thread: { ...createThreadFixture(500), isArchived: true } })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'undone', '500', '--yes'])

        expect(client.inbox.unarchiveThread).toHaveBeenCalledWith('500')
        expect(client.inbox.archiveThread).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith('Thread 500 unarchived.')
    })

    it('skips the write when the thread is already in the inbox', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'undone', '500', '--yes'])

        expect(client.inbox.unarchiveThread).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith('Thread 500 unarchived (already in target state).')
    })

    it('prompts for confirmation without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'undone', '500'])

        expect(consoleSpy).toHaveBeenCalledWith('Would unarchive: Test Thread (500)')
        expect(consoleSpy).toHaveBeenCalledWith('Use --yes to confirm.')
        expect(client.inbox.unarchiveThread).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json --yes', async () => {
        const client = createClient({ thread: { ...createThreadFixture(500), isArchived: true } })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'undone', '500', '--json', '--yes'])

        expect(client.inbox.unarchiveThread).toHaveBeenCalledWith('500')
        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual({ id: '500', isArchived: false })
    })

    it('errors when --json is used without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'undone', '500', '--json']),
        ).rejects.toHaveProperty('code', 'MISSING_YES_FLAG')

        expect(client.inbox.unarchiveThread).not.toHaveBeenCalled()
    })

    it('shows dry run output for an archived thread without a status line', async () => {
        const client = createClient({ thread: { ...createThreadFixture(500), isArchived: true } })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'undone', '500', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would unarchive thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: Test Thread (500)')
        expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Status:'))
        expect(client.inbox.unarchiveThread).not.toHaveBeenCalled()
    })

    it('shows dry run output and flags a thread already in the inbox', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'undone', '500', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would unarchive thread'))
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: Test Thread (500)')
        expect(consoleSpy).toHaveBeenCalledWith('  Status: already in inbox')
        expect(client.inbox.unarchiveThread).not.toHaveBeenCalled()
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        client.threads.getThread.mockRejectedValueOnce(new Error('thread not found'))

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'undone', '500', '--dry-run']),
        ).rejects.toThrow('thread not found')
        expect(client.inbox.unarchiveThread).not.toHaveBeenCalled()
    })
})

describe('thread mark-unread', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
        vi.mocked(readStdinToEnd).mockResolvedValue('')
    })

    it('marks a read thread unread from the start without requiring --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500'])

        expect(client.threads.markUnread).toHaveBeenCalledWith({ id: '500', objIndex: -1 })
        expect(consoleSpy).toHaveBeenCalledWith('Thread Test Thread (500) marked unread.')
    })

    it('marks unread from a comment by passing the previous object index', async () => {
        const client = createClient({ comments: [createComment(10, 0), createComment(11, 1)] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500', '--from', '11'])

        expect(client.comments.getComment).toHaveBeenCalledWith('11')
        expect(client.threads.markUnread).toHaveBeenCalledWith({ id: '500', objIndex: 0 })
        expect(consoleSpy).toHaveBeenCalledWith(
            'Thread Test Thread (500) marked unread from comment 11.',
        )
    })

    it('rejects a --from comment that belongs to another thread', async () => {
        const client = createClient({
            comments: [{ ...createComment(11, 1), threadId: '999' }],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500', '--from', '11']),
        ).rejects.toHaveProperty('code', 'INVALID_REF')
        expect(client.threads.markUnread).not.toHaveBeenCalled()
        // The comment is validated before the workspace-wide unread lookup.
        expect(client.threads.getUnread).not.toHaveBeenCalled()
    })

    it('rejects a --from comment with no object index', async () => {
        const client = createClient({
            comments: [{ ...createComment(11, 1), objIndex: undefined as unknown as number }],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500', '--from', '11']),
        ).rejects.toHaveProperty('code', 'INVALID_REF')
        expect(client.threads.markUnread).not.toHaveBeenCalled()
    })

    it('rejects --from with more than one thread ref', async () => {
        const client = createClient({ comments: [createComment(11, 1)] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'thread',
                'mark-unread',
                '500',
                '501',
                '--from',
                '11',
            ]),
        ).rejects.toHaveProperty('code', 'CONFLICTING_OPTIONS')
        expect(client.threads.markUnread).not.toHaveBeenCalled()
    })

    it('rejects --from when stdin adds a second thread ref', async () => {
        vi.mocked(readStdinToEnd).mockResolvedValueOnce('501\n')
        const client = createClient({ comments: [createComment(11, 1)] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'thread',
                'mark-unread',
                '500',
                '--from',
                '11',
                '--yes',
            ]),
        ).rejects.toHaveProperty('code', 'CONFLICTING_OPTIONS')
        expect(client.threads.markUnread).not.toHaveBeenCalled()
    })

    it.each([
        ['at the target', 0],
        ['before the target', -1],
    ])('leaves a thread already unread %s unchanged', async (_case, lastReadObjIndex) => {
        const client = createClient({
            comments: [createComment(11, 1)],
            unreadThreads: [
                {
                    threadId: '500',
                    channelId: 'CH100',
                    objIndex: lastReadObjIndex,
                    directMention: false,
                },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500', '--from', '11'])

        expect(client.threads.markUnread).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith(
            'Thread Test Thread (500) is already unread from comment 11.',
        )
    })

    it('reports the current read position in JSON when nothing changes', async () => {
        const client = createClient({
            comments: [createComment(12, 2)],
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 0, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'mark-unread',
            '500',
            '--from',
            '12',
            '--json',
        ])

        expect(client.threads.markUnread).not.toHaveBeenCalled()
        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual([{ id: '500', isRead: false, lastReadObjIndex: 0 }])
    })

    it('still moves an unread thread further back when the target is earlier', async () => {
        const client = createClient({
            unreadThreads: [
                { threadId: '500', channelId: 'CH100', objIndex: 1, directMention: false },
            ],
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500'])

        expect(client.threads.markUnread).toHaveBeenCalledWith({ id: '500', objIndex: -1 })
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(
            'Dry run: would mark unread thread Test Thread (500).',
        )
        expect(client.threads.markUnread).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual([{ id: '500', isRead: false, lastReadObjIndex: -1 }])
    })

    it('previews bulk refs from stdin and asks for --yes', async () => {
        vi.mocked(readStdinToEnd).mockResolvedValueOnce('# refs\n500\n501\n')
        const originalIsTTY = process.stdin.isTTY
        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

        try {
            const client = createClient()
            client.threads.getThread.mockImplementation(async (id: string) =>
                createThreadFixture(id),
            )
            apiMocks.getCommsClient.mockResolvedValue(client)

            const program = createProgram()
            const consoleSpy = captureConsole('log')

            await program.parseAsync(['node', 'tdc', 'thread', 'mark-unread'])

            expect(readStdinToEnd).toHaveBeenCalled()
            expect(client.threads.markUnread).not.toHaveBeenCalled()
            expect(consoleSpy).toHaveBeenCalledWith('Would mark unread thread Test Thread (500).')
            expect(consoleSpy).toHaveBeenCalledWith('Would mark unread thread Test Thread (501).')
            expect(consoleSpy).toHaveBeenCalledWith('Summary: 2 previews')
            expect(consoleSpy).toHaveBeenCalledWith('Use --yes to confirm.')
        } finally {
            Object.defineProperty(process.stdin, 'isTTY', {
                value: originalIsTTY,
                configurable: true,
            })
        }
    })

    it('marks bulk refs unread with --yes', async () => {
        const client = createClient()
        client.threads.getThread.mockImplementation(async (id: string) => createThreadFixture(id))
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500', '501', '--yes'])

        expect(client.threads.markUnread).toHaveBeenCalledWith({ id: '500', objIndex: -1 })
        expect(client.threads.markUnread).toHaveBeenCalledWith({ id: '501', objIndex: -1 })
        expect(client.threads.markUnread).toHaveBeenCalledTimes(2)
        expect(consoleSpy).toHaveBeenCalledWith('Thread Test Thread (500) marked unread.')
        expect(consoleSpy).toHaveBeenCalledWith('Thread Test Thread (501) marked unread.')
        expect(consoleSpy).toHaveBeenCalledWith('Summary: 2 changed threads')
    })

    it('emits the planned statuses with --json --dry-run', async () => {
        const client = createClient()
        client.threads.getThread.mockImplementation(async (id: string) => createThreadFixture(id))
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'mark-unread',
            '500',
            '501',
            '--json',
            '--dry-run',
        ])

        expect(client.threads.markUnread).not.toHaveBeenCalled()
        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual([
            { id: '500', isRead: false, lastReadObjIndex: -1, dryRun: true },
            { id: '501', isRead: false, lastReadObjIndex: -1, dryRun: true },
        ])
    })

    it('errors when --json is used for bulk refs without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500', '501', '--json']),
        ).rejects.toHaveProperty('code', 'MISSING_YES_FLAG')
        expect(client.threads.markUnread).not.toHaveBeenCalled()
    })

    it('surfaces markUnread failures through the shared error path', async () => {
        const client = createClient()
        client.threads.markUnread.mockRejectedValueOnce(new Error('mark failed'))
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'thread', 'mark-unread', '500']),
        ).rejects.toThrow('mark failed')
    })
})

describe('thread reply --file', () => {
    const files = useFileFixtures('tdc-reply-', 'diagram.png', 'report.pdf')

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('uploads the file and attaches it to the comment', async () => {
        const { client, program } = setupFileTest()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '500',
            'See attached',
            '--file',
            files.png,
        ])

        expect(client.attachments.upload).toHaveBeenCalledTimes(1)
        expect(client.attachments.upload).toHaveBeenCalledWith(
            expect.objectContaining({ fileName: 'diagram.png' }),
        )
        expect(client.comments.createComment).toHaveBeenCalledWith(
            expect.objectContaining({
                threadId: '500',
                content: 'See attached',
                attachments: [expect.objectContaining({ fileName: 'diagram.png' })],
            }),
        )
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Attached: diagram.png'))
    })

    it('attaches multiple repeated --file values', async () => {
        const { client, program } = setupFileTest()

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '500',
            'two files',
            '--file',
            files.png,
            '--file',
            files.pdf,
        ])

        expect(client.attachments.upload).toHaveBeenCalledTimes(2)
        const args = client.comments.createComment.mock.calls[0][0] as {
            attachments: Array<{ fileName?: string }>
        }
        expect(args.attachments.map((a) => a.fileName)).toEqual(['diagram.png', 'report.pdf'])
    })

    it('allows a file-only reply with no text content', async () => {
        const { client, program } = setupFileTest()

        await program.parseAsync(['node', 'tdc', 'thread', 'reply', '500', '--file', files.png])

        expect(client.comments.createComment).toHaveBeenCalledWith(
            expect.objectContaining({ content: '', attachments: expect.any(Array) }),
        )
        // A file-only reply must not block on the editor.
        expect(openEditor).not.toHaveBeenCalled()
    })

    it('errors with FILE_NOT_FOUND for a missing path and does not post', async () => {
        const { client, program } = setupFileTest()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'thread',
                'reply',
                '500',
                'x',
                '--file',
                join(files.dir, 'missing.png'),
            ]),
        ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })

        expect(client.attachments.upload).not.toHaveBeenCalled()
        expect(client.comments.createComment).not.toHaveBeenCalled()
    })

    it('rejects --file combined with --close', async () => {
        const { client, program } = setupFileTest()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'thread',
                'reply',
                '500',
                'x',
                '--close',
                '--file',
                files.png,
            ]),
        ).rejects.toMatchObject({ code: 'CONFLICTING_OPTIONS' })

        expect(client.attachments.upload).not.toHaveBeenCalled()
    })

    it('does not upload during --dry-run but lists the attachment', async () => {
        const { client, program } = setupFileTest()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'reply',
            '500',
            'preview',
            '--file',
            files.png,
            '--dry-run',
        ])

        expect(client.attachments.upload).not.toHaveBeenCalled()
        expect(client.comments.createComment).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(files.png))
    })
})

describe('thread create --file', () => {
    const files = useFileFixtures('tdc-create-', 'cover.png', 'spec.pdf')

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('uploads files and attaches them to the new thread', async () => {
        const { client, program } = setupFileTest()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            'CH100',
            'Release notes',
            'See attached',
            '--file',
            files.png,
            '--file',
            files.pdf,
        ])

        expect(client.attachments.upload).toHaveBeenCalledTimes(2)
        const args = client.threads.createThread.mock.calls[0][0] as {
            title: string
            content: string
            attachments: Array<{ fileName?: string }>
        }
        expect(args.title).toBe('Release notes')
        expect(args.content).toBe('See attached')
        expect(args.attachments.map((a) => a.fileName)).toEqual(['cover.png', 'spec.pdf'])
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Attached: cover.png, spec.pdf'),
        )
    })

    it('allows a file-only thread (title only, no body) without opening the editor', async () => {
        const { client, program } = setupFileTest()

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            'CH100',
            'Title',
            '--file',
            files.png,
        ])

        const args = client.threads.createThread.mock.calls[0][0] as {
            content: string
            attachments: unknown[]
        }
        expect(args.content).toBe('')
        expect(args.attachments).toHaveLength(1)
        expect(openEditor).not.toHaveBeenCalled()
    })

    it('errors with FILE_NOT_FOUND for a missing path and does not create the thread', async () => {
        const { client, program } = setupFileTest()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'thread',
                'create',
                'CH100',
                'Title',
                'body',
                '--file',
                join(files.dir, 'missing.png'),
            ]),
        ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })

        expect(client.attachments.upload).not.toHaveBeenCalled()
        expect(client.threads.createThread).not.toHaveBeenCalled()
    })

    it('does not upload during --dry-run but lists the attachment', async () => {
        const { client, program } = setupFileTest()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'thread',
            'create',
            'CH100',
            'Title',
            'body',
            '--file',
            files.png,
            '--dry-run',
        ])

        expect(client.attachments.upload).not.toHaveBeenCalled()
        expect(client.threads.createThread).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(files.png))
    })
})

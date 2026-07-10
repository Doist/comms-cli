import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    captureConsole,
    createTestProgram,
    describeEmptyMachineOutput,
} from '@doist/cli-core/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWorkspaceUserCache } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    getCurrentWorkspaceId: vi.fn().mockResolvedValue(1),
    getSessionUser: vi.fn().mockResolvedValue({ id: 1, fullName: 'Me' }),
}))

const refsMocks = vi.hoisted(() => ({
    resolveConversationId: vi.fn((ref: string) => ref),
    resolveWorkspaceRef: vi.fn(),
    resolveUserRefs: vi.fn(),
}))

vi.mock('../../lib/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/api.js')>()),
    ...apiMocks,
}))

vi.mock('../../lib/refs.js', () => refsMocks)

vi.mock('../../lib/markdown.js', () => ({
    renderMarkdown: vi.fn((text: string) => Promise.resolve(text)),
}))

vi.mock('chalk')

vi.mock('../../lib/input.js', () => ({
    readStdin: vi.fn().mockResolvedValue(''),
    openEditor: vi.fn().mockResolvedValue(''),
}))

import { openEditor } from '../../lib/input.js'
import { registerConversationCommand } from './index.js'

type TestConversation = {
    id: string
    workspaceId: number
    userIds: number[]
    title: string | null
    messageCount: number
    lastActive: Date
    archived: boolean
    created: Date
    creator: number
    lastObjIndex: number
    snippet: string
    snippetCreators: number[]
    url: string
    lastMessage: null
}

function createConversation(
    id: number | string,
    userIds: number[],
    lastActive: string,
): TestConversation {
    const sid = String(id)
    return {
        id: sid,
        workspaceId: 1,
        userIds,
        title: null,
        messageCount: 1,
        lastActive: new Date(lastActive),
        archived: false,
        created: new Date('2026-03-01T00:00:00.000Z'),
        creator: userIds[0],
        lastObjIndex: 1,
        snippet: `Snippet ${sid}`,
        snippetCreators: [userIds[0]],
        url: `https://comms.todoist.com/a/1/msg/${sid}`,
        lastMessage: null,
    }
}

function createClient({
    activeConversations = [],
    archivedConversations = [],
    messagesByConversation = {},
    users = {},
}: {
    activeConversations?: TestConversation[]
    archivedConversations?: TestConversation[]
    messagesByConversation?: Record<string, Array<Record<string, unknown>>>
    users?: Record<number, { id: number; fullName: string }>
}) {
    const conversationsById = new Map(
        [...activeConversations, ...archivedConversations].map((conversation) => [
            conversation.id,
            conversation,
        ]),
    )

    return {
        conversations: {
            getConversations: vi.fn(async ({ archived }: { archived?: boolean }) =>
                archived ? archivedConversations : activeConversations,
            ),
            getUnread: vi.fn().mockResolvedValue({ data: [], version: 1 }),
            getConversation: vi.fn(async (id: string) => conversationsById.get(id)),
            archiveConversation: vi.fn(),
            muteConversation: vi.fn(async ({ id, minutes }: { id: string; minutes: number }) => ({
                ...conversationsById.get(id),
                mutedUntil: new Date(Date.now() + minutes * 60000),
            })),
            unmuteConversation: vi.fn(async (id: string) => ({
                ...conversationsById.get(id),
                mutedUntil: null,
            })),
        },
        conversationMessages: {
            getMessages: vi.fn(
                async ({
                    conversationId,
                }: {
                    conversationId: string
                    limit?: number
                    newerThan?: Date
                    olderThan?: Date
                }) => messagesByConversation[conversationId] ?? [],
            ),
            createMessage: vi.fn(
                async (args: {
                    conversationId: string
                    content: string
                    attachments?: Array<{ fileName?: string | null }>
                }) => ({
                    id: '999',
                    conversationId: args.conversationId,
                    content: args.content,
                    url: 'https://comms.todoist.com/a/1/msg/999',
                }),
            ),
        },
        attachments: {
            upload: vi.fn(async (args: { file: Blob; fileName: string }) => ({
                attachmentId: `att-${args.fileName}`,
                urlType: 'file',
                fileName: args.fileName,
            })),
        },
        workspaceUsers: {
            getUserById: vi.fn(
                async ({ userId }: { workspaceId: number; userId: number }) => users[userId],
            ),
            getWorkspaceUsers: vi.fn(async () => Object.values(users)),
        },
    }
}

const createProgram = () => createTestProgram(registerConversationCommand)

// Shared setup for the --file suite: a fresh mock client wired into getCommsClient
// plus a program. Tests asserting on output call captureConsole('log') themselves.
function setupFileTest() {
    const client = createClient({})
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

// Cache lives in api.ts module scope, so reset between tests.
beforeEach(() => {
    clearWorkspaceUserCache()
})

describe('conversation implicit view', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCommsClient.mockRejectedValue(new Error('MOCK_API_REACHED'))
    })

    it('tdc conversation <ref> routes to view (not unknown command)', async () => {
        const program = createProgram()
        captureConsole('log')

        await expect(program.parseAsync(['node', 'tdc', 'conversation', '100'])).rejects.toThrow(
            'MOCK_API_REACHED',
        )
    })
})

describe('conversation unread --workspace conflict', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('errors when both positional and --workspace are provided', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'conversation',
                'unread',
                'Doist',
                '--workspace',
                'Other',
            ]),
        ).rejects.toThrow('Cannot specify workspace both as argument and --workspace flag')
    })
})

describeEmptyMachineOutput('conversation unread empty output', {
    setup: () => {
        vi.clearAllMocks()
        const client = createClient({})
        apiMocks.getCommsClient.mockResolvedValue(client)
    },
    run: async (extraArgs) => {
        const program = createProgram()
        await program.parseAsync(['node', 'tdc', 'conversation', 'unread', ...extraArgs])
    },
    humanMessage: 'No unread conversations.',
})

describe('conversation with', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        refsMocks.resolveUserRefs.mockResolvedValue([2])
    })

    it('prints the exact 1:1 conversation for a user', async () => {
        const directConversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const groupConversation = createConversation(43, [1, 2, 3], '2026-03-09T10:00:00.000Z')
        const client = createClient({
            activeConversations: [directConversation, groupConversation],
            users: {
                1: { id: 1, fullName: 'Me' },
                2: { id: 2, fullName: 'Alice Example' },
                3: { id: 3, fullName: 'Bob Example' },
            },
        })

        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Alice'])

        expect(refsMocks.resolveUserRefs).toHaveBeenCalledWith('Alice', 1)
        expect(refsMocks.resolveConversationId).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith('Conversation with Me, Alice Example')
        expect(client.conversations.getConversations).toHaveBeenCalledWith({ workspaceId: 1 })
    })

    it('searches archived conversations when no active 1:1 is found', async () => {
        const archivedConversation = createConversation(42, [1, 2], '2024-05-31T12:52:09.000Z')
        const client = createClient({
            activeConversations: [createConversation(43, [1, 3], '2026-03-08T10:00:00.000Z')],
            archivedConversations: [archivedConversation],
            users: {
                1: { id: 1, fullName: 'Me' },
                2: { id: 2, fullName: 'Alice Example' },
                3: { id: 3, fullName: 'Bob Example' },
            },
        })

        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Alice'])

        expect(client.conversations.getConversations).toHaveBeenCalledWith({ workspaceId: 1 })
        expect(client.conversations.getConversations).toHaveBeenCalledWith({
            workspaceId: 1,
            archived: true,
        })
    })

    it('lists matching group conversations when --include-groups is set', async () => {
        const directConversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const groupConversation = createConversation(43, [1, 2, 3], '2026-03-09T10:00:00.000Z')
        const client = createClient({
            activeConversations: [directConversation, groupConversation],
            users: {
                1: { id: 1, fullName: 'Me' },
                2: { id: 2, fullName: 'Alice Example' },
                3: { id: 3, fullName: 'Bob Example' },
            },
        })

        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'with',
            'Alice',
            '--include-groups',
            '--json',
        ])

        expect(refsMocks.resolveConversationId).not.toHaveBeenCalled()
        expect(
            JSON.parse(consoleSpy.mock.calls[0][0]).map(
                (conversation: { id: string }) => conversation.id,
            ),
        ).toEqual(['43', '42'])
    })

    it('finds the self-conversation when looking up yourself', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([1])
        const selfConversation = createConversation(10, [1], '2026-03-10T10:00:00.000Z')
        const client = createClient({
            activeConversations: [selfConversation],
            users: { 1: { id: 1, fullName: 'Me' } },
        })

        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Me'])

        expect(consoleSpy).toHaveBeenCalledWith('Conversation with Me')
    })

    it('emits empty JSON array when no 1:1 conversation is found with --json', async () => {
        const client = createClient({
            activeConversations: [],
            users: {
                1: { id: 1, fullName: 'Me' },
                2: { id: 2, fullName: 'Alice Example' },
            },
        })

        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Alice', '--json'])

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual([])
    })

    it('prints a clean error and exits non-zero for ambiguous user refs', async () => {
        refsMocks.resolveUserRefs.mockRejectedValue(
            new CliError(
                'AMBIGUOUS_USER',
                'Multiple users match "Alex":\n  1  Alex <alex@example.com>\n\nUse numeric ID to specify.',
            ),
        )

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Alex']),
        ).rejects.toHaveProperty('code', 'AMBIGUOUS_USER')
    })
})

describe('conversation list', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        refsMocks.resolveUserRefs.mockResolvedValue([2])
    })

    const standardUsers = {
        1: { id: 1, fullName: 'Me' },
        2: { id: 2, fullName: 'Alice Example' },
        3: { id: 3, fullName: 'Bob Example' },
    }

    function titled(
        id: number,
        userIds: number[],
        lastActive: string,
        title: string,
    ): TestConversation {
        return { ...createConversation(id, userIds, lastActive), title }
    }

    it('lists active conversations sorted by last activity', async () => {
        const client = createClient({
            activeConversations: [
                titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'Older direct'),
                titled(43, [1, 2, 3], '2026-03-09T10:00:00.000Z', 'Newer group'),
            ],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'list'])

        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        // Newest first.
        expect(output.indexOf('Newer group')).toBeLessThan(output.indexOf('Older direct'))
        expect(output).toContain('id:43')
        expect(output).toContain('id:42')
        // Active-only default never touches the archived fetch.
        expect(client.conversations.getConversations).toHaveBeenCalledWith({ workspaceId: 1 })
        expect(client.conversations.getConversations).not.toHaveBeenCalledWith({
            workspaceId: 1,
            archived: true,
        })
    })

    it('filters to conversations that include a given participant', async () => {
        const client = createClient({
            activeConversations: [
                titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'With Alice'),
                titled(43, [1, 3], '2026-03-09T10:00:00.000Z', 'With Bob'),
            ],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'list',
            '--participant',
            'Alice',
            '--json',
        ])

        // Resolve against the full roster so a participant who has left the
        // workspace still matches (renderer shows removed participants).
        expect(refsMocks.resolveUserRefs).toHaveBeenCalledWith('Alice', 1, { includeRemoved: true })
        expect(JSON.parse(consoleSpy.mock.calls[0][0]).map((c: { id: string }) => c.id)).toEqual([
            '42',
        ])
    })

    it('requires ALL given participants to be present', async () => {
        refsMocks.resolveUserRefs.mockResolvedValue([2, 3])
        const client = createClient({
            activeConversations: [
                titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'Just Alice'),
                titled(43, [1, 2, 3], '2026-03-09T10:00:00.000Z', 'Alice and Bob'),
            ],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'list',
            '--participant',
            'Alice,Bob',
            '--json',
        ])

        expect(JSON.parse(consoleSpy.mock.calls[0][0]).map((c: { id: string }) => c.id)).toEqual([
            '43',
        ])
    })

    it('filters by case-insensitive title substring with --name', async () => {
        const client = createClient({
            activeConversations: [
                titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'Release planning'),
                titled(43, [1, 3], '2026-03-09T10:00:00.000Z', 'Lunch plans'),
            ],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'list',
            '--name',
            'release',
            '--json',
        ])

        expect(JSON.parse(consoleSpy.mock.calls[0][0]).map((c: { id: string }) => c.id)).toEqual([
            '42',
        ])
    })

    it('lists only group conversations with --kind group', async () => {
        const client = createClient({
            activeConversations: [
                titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'Direct'),
                titled(43, [1, 2, 3], '2026-03-09T10:00:00.000Z', 'Group'),
            ],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'list',
            '--kind',
            'group',
            '--json',
        ])

        expect(JSON.parse(consoleSpy.mock.calls[0][0]).map((c: { id: string }) => c.id)).toEqual([
            '43',
        ])
    })

    it('lists only 1:1s (and the self-conversation) with --kind direct', async () => {
        const client = createClient({
            activeConversations: [
                titled(10, [1], '2026-03-10T10:00:00.000Z', 'Self'),
                titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'Direct'),
                titled(43, [1, 2, 3], '2026-03-09T10:00:00.000Z', 'Group'),
            ],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'list',
            '--kind',
            'direct',
            '--json',
        ])

        expect(
            JSON.parse(consoleSpy.mock.calls[0][0])
                .map((c: { id: string }) => c.id)
                .sort(),
        ).toEqual(['10', '42'])
    })

    it('rejects an invalid --kind value via Commander choices', async () => {
        const client = createClient({ activeConversations: [], users: standardUsers })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'list', '--kind', 'nope']),
        ).rejects.toThrow(/Allowed choices are group, direct/)
    })

    it('fetches only archived conversations with --state archived', async () => {
        const client = createClient({
            activeConversations: [titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'Active')],
            archivedConversations: [titled(43, [1, 3], '2026-03-09T10:00:00.000Z', 'Archived')],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'list',
            '--state',
            'archived',
            '--json',
        ])

        expect(client.conversations.getConversations).toHaveBeenCalledWith({
            workspaceId: 1,
            archived: true,
        })
        expect(client.conversations.getConversations).not.toHaveBeenCalledWith({ workspaceId: 1 })
        expect(JSON.parse(consoleSpy.mock.calls[0][0]).map((c: { id: string }) => c.id)).toEqual([
            '43',
        ])
    })

    it('includes archived conversations with --state all', async () => {
        const client = createClient({
            activeConversations: [titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'Active')],
            archivedConversations: [titled(43, [1, 3], '2026-03-09T10:00:00.000Z', 'Archived')],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'list',
            '--state',
            'all',
            '--json',
        ])

        expect(
            JSON.parse(consoleSpy.mock.calls[0][0])
                .map((c: { id: string }) => c.id)
                .sort(),
        ).toEqual(['42', '43'])
    })

    it('caps the number of rows with --limit', async () => {
        const client = createClient({
            activeConversations: [
                titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'One'),
                titled(43, [1, 3], '2026-03-09T10:00:00.000Z', 'Two'),
                titled(44, [1, 2, 3], '2026-03-10T10:00:00.000Z', 'Three'),
            ],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'list', '--limit', '2', '--json'])

        // Newest-first, capped at 2.
        expect(JSON.parse(consoleSpy.mock.calls[0][0]).map((c: { id: string }) => c.id)).toEqual([
            '44',
            '43',
        ])
    })

    it('rejects a non-positive --limit value', async () => {
        const client = createClient({ activeConversations: [], users: standardUsers })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'list', '--limit', '0']),
        ).rejects.toHaveProperty('code', 'INVALID_LIMIT')
    })

    it('filters JSON fields unless --full is set', async () => {
        const client = createClient({
            activeConversations: [titled(42, [1, 2], '2026-03-08T10:00:00.000Z', 'Release')],
            users: standardUsers,
        })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'list', '--json'])

        const item = JSON.parse(consoleSpy.mock.calls[0][0])[0]
        expect(Object.keys(item).sort()).toEqual([
            'archived',
            'id',
            'lastActive',
            'messageCount',
            'title',
            'userIds',
            'workspaceId',
        ])
        expect(item.participantNames).toBeUndefined()
        expect(item.snippet).toBeUndefined()
        // Machine output without --full must not pay for the workspace user map.
        expect(client.workspaceUsers.getWorkspaceUsers).not.toHaveBeenCalled()

        consoleSpy.mockClear()

        await program.parseAsync(['node', 'tdc', 'conversation', 'list', '--json', '--full'])

        const fullItem = JSON.parse(consoleSpy.mock.calls[0][0])[0]
        expect(fullItem.participantNames).toEqual(['Me', 'Alice Example'])
        expect(fullItem.snippet).toBe('Snippet 42')
        expect(fullItem.url).toBeTruthy()
        // --full needs names, so the map fetch happens here.
        expect(client.workspaceUsers.getWorkspaceUsers).toHaveBeenCalled()
    })

    it('prints the empty message when nothing matches', async () => {
        const client = createClient({ activeConversations: [], users: standardUsers })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'list'])

        expect(consoleSpy).toHaveBeenCalledWith('No matching conversations found.')
    })

    it('errors when both positional and --workspace are provided', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'conversation',
                'list',
                'Doist',
                '--workspace',
                'Other',
            ]),
        ).rejects.toThrow('Cannot specify workspace both as argument and --workspace flag')
    })
})

describe('conversation view machine output', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('filters conversation and message fields unless --full is set', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({
            activeConversations: [conversation],
            messagesByConversation: {
                '42': [
                    {
                        id: '99',
                        content: '**hello**',
                        creator: 2,
                        conversationId: '42',
                        workspaceId: 1,
                        posted: new Date('2026-03-08T10:05:00.000Z'),
                        reactions: [],
                        extra: 'message-extra',
                    },
                ],
            },
            users: {
                1: { id: 1, fullName: 'Me' },
                2: { id: 2, fullName: 'Alice Example' },
            },
        })

        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'view', '42', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.conversation).toEqual({
            id: '42',
            workspaceId: 1,
            userIds: [1, 2],
            title: null,
            messageCount: 1,
            lastActive: '2026-03-08T10:00:00.000Z',
            archived: false,
        })
        expect(jsonOutput.messages).toEqual([
            {
                id: '99',
                content: '**hello**',
                creator: 2,
                conversationId: '42',
                posted: '2026-03-08T10:05:00.000Z',
                reactions: [],
            },
        ])

        consoleSpy.mockClear()

        await program.parseAsync(['node', 'tdc', 'conversation', 'view', '42', '--ndjson'])

        expect(consoleSpy.mock.calls.map((call) => JSON.parse(call[0]))).toEqual([
            {
                type: 'conversation',
                id: '42',
                workspaceId: 1,
                userIds: [1, 2],
                title: null,
                messageCount: 1,
                lastActive: '2026-03-08T10:00:00.000Z',
                archived: false,
            },
            {
                type: 'message',
                id: '99',
                content: '**hello**',
                creator: 2,
                conversationId: '42',
                posted: '2026-03-08T10:05:00.000Z',
                reactions: [],
            },
        ])

        consoleSpy.mockClear()

        await program.parseAsync(['node', 'tdc', 'conversation', 'view', '42', '--json', '--full'])

        const fullJsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(fullJsonOutput.conversation.participantNames).toEqual(['Me', 'Alice Example'])
        expect(fullJsonOutput.messages[0].creatorName).toBe('Alice Example')
        expect(fullJsonOutput.messages[0].extra).toBe('message-extra')
    })
})

describe('conversation view date filters', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('maps --since and --until to getMessages date filters', async () => {
        const conversation = createConversation(42, [1], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'view',
            '42',
            '--since',
            '2026-06-26',
            '--until',
            '2026-06-30',
            '--json',
        ])

        expect(client.conversationMessages.getMessages).toHaveBeenCalledWith({
            conversationId: '42',
            newerThan: new Date('2026-06-26'),
            olderThan: new Date('2026-06-30'),
            limit: 50,
        })
    })
})

describe('conversation view error propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('surfaces the API error when conversation fetch fails', async () => {
        const client = createClient({})
        client.conversations.getConversation.mockRejectedValueOnce(
            new Error('Conversation not found'),
        )
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'view', '42']),
        ).rejects.toThrow('Conversation not found')
    })

    it('renders user:N when participant name lookups all fail', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({
            activeConversations: [conversation],
            messagesByConversation: { '42': [] },
        })
        client.workspaceUsers.getUserById.mockRejectedValue(new Error('User lookup failed'))
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        // view.ts swallows individual user-lookup failures and falls back to
        // `user:${id}` — the conversation itself still renders.
        await program.parseAsync(['node', 'tdc', 'conversation', 'view', '42'])

        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
        expect(output).toContain('user:1')
        expect(output).toContain('user:2')
    })
})

describe('conversation mute', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('mutes a conversation with default 60 minutes', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'mute', '42'])

        expect(client.conversations.muteConversation).toHaveBeenCalledWith({
            id: '42',
            minutes: 60,
        })
        expect(consoleSpy).toHaveBeenCalledWith('Conversation 42 muted for 60 minutes.')
    })

    it('mutes a conversation with custom minutes', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'mute', '42', '--minutes', '480'])

        expect(client.conversations.muteConversation).toHaveBeenCalledWith({
            id: '42',
            minutes: 480,
        })
        expect(consoleSpy).toHaveBeenCalledWith('Conversation 42 muted for 480 minutes.')
    })

    it('shows dry run output', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'mute', '42', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would mute conversation'))
        expect(consoleSpy).toHaveBeenCalledWith('  Conversation: conversation 42')
        expect(consoleSpy).toHaveBeenCalledWith('  Duration: 60 minutes')
        expect(client.conversations.muteConversation).not.toHaveBeenCalled()
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient({ activeConversations: [] })
        client.conversations.getConversation.mockRejectedValueOnce(
            new Error('conversation not found'),
        )
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'mute', '42', '--dry-run']),
        ).rejects.toThrow('conversation not found')
        expect(client.conversations.muteConversation).not.toHaveBeenCalled()
    })

    it('rejects non-integer --minutes value', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'mute', '42', '--minutes', 'foo']),
        ).rejects.toHaveProperty('code', 'INVALID_MINUTES')
    })
})

describe('conversation unmute', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('unmutes a conversation', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'unmute', '42'])

        expect(client.conversations.unmuteConversation).toHaveBeenCalledWith('42')
        expect(consoleSpy).toHaveBeenCalledWith('Conversation 42 unmuted.')
    })

    it('shows dry run output', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'unmute', '42', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Would unmute conversation'),
        )
        expect(consoleSpy).toHaveBeenCalledWith('  Conversation: conversation 42')
        expect(client.conversations.unmuteConversation).not.toHaveBeenCalled()
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient({ activeConversations: [] })
        client.conversations.getConversation.mockRejectedValueOnce(
            new Error('conversation not found'),
        )
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'unmute', '42', '--dry-run']),
        ).rejects.toThrow('conversation not found')
        expect(client.conversations.unmuteConversation).not.toHaveBeenCalled()
    })
})

describe('conversation done', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('archives a conversation with --yes', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'done', '42', '--yes'])

        expect(client.conversations.archiveConversation).toHaveBeenCalledWith('42')
        expect(consoleSpy).toHaveBeenCalledWith('Conversation 42 archived.')
    })

    it('prompts for confirmation without --yes', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'done', '42'])

        expect(consoleSpy).toHaveBeenCalledWith('Would archive: conversation 42')
        expect(consoleSpy).toHaveBeenCalledWith('Use --yes to confirm.')
        expect(client.conversations.archiveConversation).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json --yes', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'done', '42', '--json', '--yes'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual({ id: '42', archived: true })
    })

    it('errors when --json is used without --yes', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'done', '42', '--json']),
        ).rejects.toHaveProperty('code', 'MISSING_YES_FLAG')

        expect(client.conversations.archiveConversation).not.toHaveBeenCalled()
    })

    it('shows dry run output', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'conversation', 'done', '42', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Would archive conversation'),
        )
        expect(consoleSpy).toHaveBeenCalledWith('  Conversation: conversation 42')
        expect(client.conversations.archiveConversation).not.toHaveBeenCalled()
    })

    it('runs validation in dry-run mode', async () => {
        const client = createClient({ activeConversations: [] })
        client.conversations.getConversation.mockRejectedValueOnce(
            new Error('conversation not found'),
        )
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'conversation', 'done', '42', '--dry-run']),
        ).rejects.toThrow('conversation not found')
        expect(client.conversations.archiveConversation).not.toHaveBeenCalled()
    })
})

describe('conversation reply --file', () => {
    const files = useFileFixtures('tdc-convo-reply-', 'photo.png', 'doc.pdf')

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('uploads the file and attaches it to the message', async () => {
        const { client, program } = setupFileTest()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'reply',
            '42',
            'See attached',
            '--file',
            files.png,
        ])

        expect(client.attachments.upload).toHaveBeenCalledTimes(1)
        expect(client.attachments.upload).toHaveBeenCalledWith(
            expect.objectContaining({ fileName: 'photo.png' }),
        )
        expect(client.conversationMessages.createMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                conversationId: '42',
                content: 'See attached',
                attachments: [expect.objectContaining({ fileName: 'photo.png' })],
            }),
        )
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Attached: photo.png'))
    })

    it('attaches multiple repeated --file values', async () => {
        const { client, program } = setupFileTest()

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'reply',
            '42',
            'two files',
            '--file',
            files.png,
            '--file',
            files.pdf,
        ])

        expect(client.attachments.upload).toHaveBeenCalledTimes(2)
        const args = client.conversationMessages.createMessage.mock.calls[0][0] as {
            attachments: Array<{ fileName?: string }>
        }
        expect(args.attachments.map((a) => a.fileName)).toEqual(['photo.png', 'doc.pdf'])
    })

    it('allows a file-only message with no text content', async () => {
        const { client, program } = setupFileTest()

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'reply',
            '42',
            '--file',
            files.png,
        ])

        expect(client.conversationMessages.createMessage).toHaveBeenCalledWith(
            expect.objectContaining({ content: '', attachments: expect.any(Array) }),
        )
        // A file-only message must not block on the editor.
        expect(openEditor).not.toHaveBeenCalled()
    })

    it('errors with FILE_NOT_FOUND for a missing path and does not send', async () => {
        const { client, program } = setupFileTest()

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'conversation',
                'reply',
                '42',
                'x',
                '--file',
                join(files.dir, 'missing.png'),
            ]),
        ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })

        expect(client.attachments.upload).not.toHaveBeenCalled()
        expect(client.conversationMessages.createMessage).not.toHaveBeenCalled()
    })

    it('skips the upload when the conversation preflight fails (no orphaned upload)', async () => {
        const { client, program } = setupFileTest()
        client.conversations.getConversation.mockRejectedValueOnce(
            new CliError('NOT_FOUND', 'Conversation not found'),
        )

        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'conversation',
                'reply',
                '42',
                'See attached',
                '--file',
                files.png,
            ]),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' })

        expect(client.attachments.upload).not.toHaveBeenCalled()
        expect(client.conversationMessages.createMessage).not.toHaveBeenCalled()
    })

    it('does not upload during --dry-run but lists the attachment', async () => {
        const { client, program } = setupFileTest()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'conversation',
            'reply',
            '42',
            'preview',
            '--file',
            files.png,
            '--dry-run',
        ])

        expect(client.attachments.upload).not.toHaveBeenCalled()
        expect(client.conversationMessages.createMessage).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(files.png))
    })
})

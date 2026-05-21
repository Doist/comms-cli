import { describeEmptyMachineOutput } from '@doist/cli-core/testing'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
                async ({ conversationId }: { conversationId: string; limit?: number }) =>
                    messagesByConversation[conversationId] ?? [],
            ),
            createMessage: vi.fn(),
        },
        workspaceUsers: {
            getUserById: vi.fn(
                async ({ userId }: { workspaceId: number; userId: number }) => users[userId],
            ),
            getWorkspaceUsers: vi.fn(async () => Object.values(users)),
        },
    }
}

function createProgram() {
    const program = new Command()
    program.exitOverride()
    registerConversationCommand(program)
    return program
}

describe('conversation implicit view', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
        apiMocks.getCommsClient.mockRejectedValue(new Error('MOCK_API_REACHED'))
    })

    it('tdc conversation <ref> routes to view (not unknown command)', async () => {
        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await expect(program.parseAsync(['node', 'tdc', 'conversation', '100'])).rejects.toThrow(
            'MOCK_API_REACHED',
        )

        consoleSpy.mockRestore()
    })
})

describe('conversation unread --workspace conflict', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
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
        clearWorkspaceUserCache()
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
        clearWorkspaceUserCache()
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
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Alice'])

        expect(refsMocks.resolveUserRefs).toHaveBeenCalledWith('Alice', 1)
        expect(refsMocks.resolveConversationId).not.toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith('Conversation with Me, Alice Example')
        expect(client.conversations.getConversations).toHaveBeenCalledWith({ workspaceId: 1 })

        consoleSpy.mockRestore()
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
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Alice'])

        expect(client.conversations.getConversations).toHaveBeenCalledWith({ workspaceId: 1 })
        expect(client.conversations.getConversations).toHaveBeenCalledWith({
            workspaceId: 1,
            archived: true,
        })

        consoleSpy.mockRestore()
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
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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

        consoleSpy.mockRestore()
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
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Me'])

        expect(consoleSpy).toHaveBeenCalledWith('Conversation with Me')

        consoleSpy.mockRestore()
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
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'with', 'Alice', '--json'])

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual([])

        consoleSpy.mockRestore()
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

describe('conversation view machine output', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
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
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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

        consoleSpy.mockRestore()
    })
})

describe('conversation view error propagation', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
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
})

describe('conversation mute', () => {
    beforeEach(() => {
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('mutes a conversation with default 60 minutes', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'mute', '42'])

        expect(client.conversations.muteConversation).toHaveBeenCalledWith({
            id: '42',
            minutes: 60,
        })
        expect(consoleSpy).toHaveBeenCalledWith('Conversation 42 muted for 60 minutes.')

        consoleSpy.mockRestore()
    })

    it('mutes a conversation with custom minutes', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'mute', '42', '--minutes', '480'])

        expect(client.conversations.muteConversation).toHaveBeenCalledWith({
            id: '42',
            minutes: 480,
        })
        expect(consoleSpy).toHaveBeenCalledWith('Conversation 42 muted for 480 minutes.')

        consoleSpy.mockRestore()
    })

    it('shows dry run output', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'mute', '42', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would mute conversation'))
        expect(consoleSpy).toHaveBeenCalledWith('  Conversation: conversation 42')
        expect(consoleSpy).toHaveBeenCalledWith('  Duration: 60 minutes')
        expect(client.conversations.muteConversation).not.toHaveBeenCalled()

        consoleSpy.mockRestore()
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
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('unmutes a conversation', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'unmute', '42'])

        expect(client.conversations.unmuteConversation).toHaveBeenCalledWith('42')
        expect(consoleSpy).toHaveBeenCalledWith('Conversation 42 unmuted.')

        consoleSpy.mockRestore()
    })

    it('shows dry run output', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'unmute', '42', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Would unmute conversation'),
        )
        expect(consoleSpy).toHaveBeenCalledWith('  Conversation: conversation 42')
        expect(client.conversations.unmuteConversation).not.toHaveBeenCalled()

        consoleSpy.mockRestore()
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
        clearWorkspaceUserCache()
        vi.clearAllMocks()
    })

    it('archives a conversation', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'done', '42'])

        expect(client.conversations.archiveConversation).toHaveBeenCalledWith('42')
        expect(consoleSpy).toHaveBeenCalledWith('Conversation 42 archived.')

        consoleSpy.mockRestore()
    })

    it('shows dry run output', async () => {
        const conversation = createConversation(42, [1, 2], '2026-03-08T10:00:00.000Z')
        const client = createClient({ activeConversations: [conversation] })
        apiMocks.getCommsClient.mockResolvedValue(client)

        const program = createProgram()
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await program.parseAsync(['node', 'tdc', 'conversation', 'done', '42', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Would archive conversation'),
        )
        expect(consoleSpy).toHaveBeenCalledWith('  Conversation: conversation 42')
        expect(client.conversations.archiveConversation).not.toHaveBeenCalled()

        consoleSpy.mockRestore()
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

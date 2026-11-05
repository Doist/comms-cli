import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refsMocks = vi.hoisted(() => ({
    resolveWorkspaceRef: vi.fn(),
    resolveUserRefs: vi.fn(),
    resolveChannelId: vi.fn(),
    resolveConversationId: vi.fn(),
}))

const searchApiMocks = vi.hoisted(() => ({
    extendedSearch: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
    getCurrentWorkspaceId: vi.fn().mockResolvedValue(1),
}))

vi.mock('../lib/refs.js', () => refsMocks)

vi.mock('../lib/global-args.js', async (importOriginal) => ({
    ...(await importOriginal()),
    includePrivateChannels: vi.fn().mockReturnValue(true),
}))

vi.mock('../lib/public-channels.js', () => ({
    getPublicChannelIds: vi.fn(),
}))

vi.mock('../lib/search-api.js', () => searchApiMocks)

vi.mock('chalk')

import { includePrivateChannels } from '../lib/global-args.js'
import { getPublicChannelIds } from '../lib/public-channels.js'
import { registerSearchCommand } from './search.js'

const createProgram = () => createTestProgram(registerSearchCommand)

describe('search --workspace conflict', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        refsMocks.resolveWorkspaceRef.mockResolvedValue({ id: 1, name: 'Doist' })
        searchApiMocks.extendedSearch.mockResolvedValue({
            items: [],
            hasMore: false,
            isPlanRestricted: false,
        })
    })

    it('errors when both positional and --workspace are provided', async () => {
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'search', 'query', 'Doist', '--workspace', 'Other']),
        ).rejects.toThrow('Cannot specify workspace both as argument and --workspace flag')
    })

    it('parses channel and conversation refs using resolvers', async () => {
        refsMocks.resolveChannelId.mockImplementation((ref: string) => {
            if (ref === 'id:10') return 10
            if (ref === 'https://comms.todoist.com/a/1/ch/20') return 20
            throw new Error('Unexpected channel ref')
        })
        refsMocks.resolveConversationId.mockImplementation((ref: string) => {
            if (ref === 'id:30') return 30
            if (ref === 'https://comms.todoist.com/a/1/msg/40') return 40
            throw new Error('Unexpected conversation ref')
        })

        const program = createProgram()
        captureConsole('log')
        await program.parseAsync([
            'node',
            'tdc',
            'search',
            'query',
            '--channel',
            'id:10,https://comms.todoist.com/a/1/ch/20',
            '--conversation',
            'id:30,https://comms.todoist.com/a/1/msg/40',
        ])

        expect(searchApiMocks.extendedSearch).toHaveBeenCalledWith(
            expect.objectContaining({
                channelIds: [10, 20],
                conversationIds: [30, 40],
            }),
        )
    })

    it('fetches every page when --all is set', async () => {
        searchApiMocks.extendedSearch
            .mockResolvedValueOnce({
                items: [],
                hasMore: true,
                nextCursorMark: 'cursor-1',
                isPlanRestricted: false,
            })
            .mockResolvedValueOnce({
                items: [],
                hasMore: false,
                isPlanRestricted: false,
            })

        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'search', 'query', '--all'])

        expect(searchApiMocks.extendedSearch).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                query: 'query',
                cursor: undefined,
            }),
        )
        expect(searchApiMocks.extendedSearch).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                query: 'query',
                cursor: 'cursor-1',
            }),
        )
    })
})

describe('search result URLs', () => {
    const conversationResult = {
        id: 'conversation_BY2ETq2pEneE5MxErhvx5',
        type: 'conversation',
        title: "Jack's Outcasts",
        snippet: "Jack's Outcasts",
        snippetCreatorId: 23910351,
        snippetLastUpdated: new Date('2026-11-04T00:00:00Z'),
        conversationId: 'BY2ETq2pEneE5MxErhvx5',
    }

    async function searchForUrl(result: Record<string, unknown>): Promise<string> {
        searchApiMocks.extendedSearch.mockResolvedValue({
            items: [result],
            hasMore: false,
            isPlanRestricted: false,
        })
        const program = createProgram()
        const logSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'search', 'Outcasts', '--json'])

        return JSON.parse(logSpy.mock.calls[0][0]).results[0].url
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('links a chat with no messageId to the conversation', async () => {
        await expect(searchForUrl(conversationResult)).resolves.toMatch(
            /\/1\/msg\/BY2ETq2pEneE5MxErhvx5\/$/,
        )
    })

    it('links a message hit to the message in its conversation', async () => {
        await expect(
            searchForUrl({ ...conversationResult, messageId: 'Cgim4JfqR97yE3PoxUYrj' }),
        ).resolves.toMatch(/\/1\/msg\/BY2ETq2pEneE5MxErhvx5\/m\/Cgim4JfqR97yE3PoxUYrj\/?$/)
    })
})

describe('search --type conversations', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(includePrivateChannels).mockReturnValue(true)
        searchApiMocks.extendedSearch.mockResolvedValue({
            items: [],
            hasMore: false,
            isPlanRestricted: false,
        })
    })

    it('requests the conversations type', async () => {
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'search', 'Outcasts', '--type', 'conversations'])

        expect(searchApiMocks.extendedSearch).toHaveBeenCalledWith(
            expect.objectContaining({ query: 'Outcasts', type: 'conversations' }),
        )
    })

    it('skips the channel lookup when no result has a channel', async () => {
        vi.mocked(includePrivateChannels).mockReturnValue(false)
        searchApiMocks.extendedSearch.mockResolvedValue({
            items: [
                {
                    id: 'conversation_chat-1',
                    type: 'conversation',
                    title: 'Outcasts',
                    snippet: 'Outcasts',
                    snippetLastUpdated: new Date('2026-01-01T00:00:00Z'),
                    conversationId: 'chat-1',
                },
            ],
            hasMore: false,
            isPlanRestricted: false,
        })
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'search', 'Outcasts', '--type', 'conversations'])

        expect(getPublicChannelIds).not.toHaveBeenCalled()
    })

    it('still filters results that have a channel', async () => {
        vi.mocked(includePrivateChannels).mockReturnValue(false)
        vi.mocked(getPublicChannelIds).mockResolvedValue(new Set(['public-channel']))
        searchApiMocks.extendedSearch.mockResolvedValue({
            items: [
                {
                    id: 'thread_private',
                    type: 'thread',
                    title: 'Private thread',
                    snippet: 'Private thread',
                    snippetLastUpdated: new Date('2026-01-01T00:00:00Z'),
                    threadId: 'private',
                    channelId: 'private-channel',
                },
            ],
            hasMore: false,
            isPlanRestricted: false,
        })
        const program = createProgram()
        const log = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'search', 'thread'])

        expect(getPublicChannelIds).toHaveBeenCalledTimes(1)
        expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Private thread'))
    })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    fetchWorkspaces: vi.fn(),
    getWorkspaceUsers: vi.fn(),
    getWorkspaceGroups: vi.fn(),
    getGroup: vi.fn(),
}))

vi.mock('./api.js', () => ({
    getCommsClient: apiMocks.getCommsClient,
    fetchWorkspaces: apiMocks.fetchWorkspaces,
    getWorkspaceUsers: apiMocks.getWorkspaceUsers,
    getWorkspaceGroups: apiMocks.getWorkspaceGroups,
    getGroup: apiMocks.getGroup,
}))

import {
    classifyCommsUrl,
    extractId,
    getDirectChannelId,
    isIdRef,
    looksLikeRawId,
    parseCommsUrl,
    parseNumericIdRefs,
    parseRef,
    partitionNotifyIds,
    resolveChannelId,
    resolveChannelMemberRefs,
    resolveChannelRef,
    resolveCommentId,
    resolveConversationId,
    resolveGroupRef,
    resolveMessageId,
    resolveThreadId,
    resolveUserRefs,
} from './refs.js'

describe('isIdRef', () => {
    it('returns true for id: prefixed strings', () => {
        expect(isIdRef('id:123')).toBe(true)
        expect(isIdRef('id:abc123')).toBe(true)
    })

    it('returns false for non-id refs', () => {
        expect(isIdRef('123')).toBe(false)
        expect(isIdRef('workspace-name')).toBe(false)
        expect(isIdRef('https://comms.todoist.com/a/123')).toBe(false)
    })
})

describe('extractId', () => {
    it('extracts ID from id: prefix', () => {
        expect(extractId('id:123')).toBe('123')
        expect(extractId('id:abc123')).toBe('abc123')
    })

    it('returns bare strings as ID', () => {
        expect(extractId('123')).toBe('123')
        expect(extractId('CeRAj1WU3YFhsTejuePLW')).toBe('CeRAj1WU3YFhsTejuePLW')
    })

    it('trims whitespace', () => {
        expect(extractId(' 123 ')).toBe('123')
        expect(extractId('id: 456')).toBe('456')
    })

    it('throws on empty input', () => {
        expect(() => extractId('')).toThrow('Invalid ID')
        expect(() => extractId('id:')).toThrow('Invalid ID')
    })
})

describe('parseNumericIdRefs', () => {
    it('parses comma-separated numeric refs', () => {
        expect(parseNumericIdRefs('id:10, 20', 'user')).toEqual([10, 20])
    })

    it('returns null when any ref needs fuzzy resolution', () => {
        expect(parseNumericIdRefs('id:10,alice@doist.com', 'user')).toBeNull()
    })

    it('rejects empty values', () => {
        expect(() => parseNumericIdRefs('id:10,,20', 'user')).toThrow('Invalid user reference list')
    })
})

describe('looksLikeRawId', () => {
    it('detects numeric strings', () => {
        expect(looksLikeRawId('123456')).toBe(true)
    })

    it('detects base58 alphanumeric strings', () => {
        expect(looksLikeRawId('CeRAj1WU3YFhsTejuePLW')).toBe(true)
    })

    it('rejects plain names and spaces', () => {
        expect(looksLikeRawId('workspace')).toBe(false)
        expect(looksLikeRawId('CbjxNkWHJBwcaVkoTCRgM')).toBe(false)
        expect(looksLikeRawId('CustomerSuccessLeadership')).toBe(false)
        expect(looksLikeRawId('workspace one')).toBe(false)
    })
})

describe('parseCommsUrl', () => {
    it('parses workspace URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345')
        expect(result).toEqual({ workspaceId: 12345 })
    })

    it('parses short workspace URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/12345')
        expect(result).toEqual({ workspaceId: 12345 })
    })

    it.each([
        ['channel', 'https://comms.todoist.com/a/12345/ch/CH1'],
        ['thread', 'https://comms.todoist.com/a/12345/ch/CH1/t/TH1'],
        ['conversation', 'https://comms.todoist.com/a/12345/msg/CV1'],
    ])('reads a well-formed %s URL with a non-base58 id as workspace-only', (_name, url) => {
        // Comms only issues base58-encoded UUIDv7 ids, so anything else names
        // no entity and must not be passed on as a ref.
        expect(parseCommsUrl(url)).toEqual({ workspaceId: 12345 })
    })

    it('parses channel URL with base58 id', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW')
        expect(result).toEqual({ workspaceId: 12345, channelId: 'CeRAj1WU3YFhsTejuePLW' })
    })

    it('parses short channel URL with base58 id', () => {
        const result = parseCommsUrl('https://comms.todoist.com/12345/ch/CeRAj1WU3YFhsTejuePLW')
        expect(result).toEqual({ workspaceId: 12345, channelId: 'CeRAj1WU3YFhsTejuePLW' })
    })

    it.each([
        [
            'short thread URL',
            'https://comms.todoist.com/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
            {
                workspaceId: 12345,
                channelId: 'CeRAj1WU3YFhsTejuePLW',
                threadId: 'CeRAj1WU3YFhsVZGDyPr9',
            },
        ],
        [
            'thread URL',
            'https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
            {
                workspaceId: 12345,
                channelId: 'CeRAj1WU3YFhsTejuePLW',
                threadId: 'CeRAj1WU3YFhsVZGDyPr9',
            },
        ],
        [
            'short thread with comment URL',
            'https://comms.todoist.com/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            {
                workspaceId: 12345,
                channelId: 'CeRAj1WU3YFhsTejuePLW',
                threadId: 'CeRAj1WU3YFhsVZGDyPr9',
                commentId: 'CeRAj1WU3YFhsY6fUxMhj',
            },
        ],
        [
            'thread with comment URL',
            'https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            {
                workspaceId: 12345,
                channelId: 'CeRAj1WU3YFhsTejuePLW',
                threadId: 'CeRAj1WU3YFhsVZGDyPr9',
                commentId: 'CeRAj1WU3YFhsY6fUxMhj',
            },
        ],
        [
            'people URL as workspace-only',
            'https://comms.todoist.com/12345/people/u/678',
            { workspaceId: 12345 },
        ],
    ])('parses %s', (_description, url, expected) => {
        expect(parseCommsUrl(url)).toEqual(expected)
    })

    it.each([
        [
            'inbox thread URL',
            'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/',
            { workspaceId: 12345, threadId: 'CeRAj1WU3YFhsVZGDyPr9' },
        ],
        [
            'inbox thread with comment URL',
            'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            {
                workspaceId: 12345,
                threadId: 'CeRAj1WU3YFhsVZGDyPr9',
                commentId: 'CeRAj1WU3YFhsY6fUxMhj',
            },
        ],
        [
            'saved thread URL',
            'https://comms.todoist.com/12345/saved/t/CeRAj1WU3YFhsVZGDyPr9',
            { workspaceId: 12345, threadId: 'CeRAj1WU3YFhsVZGDyPr9' },
        ],
        [
            'saved thread with comment URL',
            'https://comms.todoist.com/12345/saved/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            {
                workspaceId: 12345,
                threadId: 'CeRAj1WU3YFhsVZGDyPr9',
                commentId: 'CeRAj1WU3YFhsY6fUxMhj',
            },
        ],
    ])('parses %s', (_description, url, expected) => {
        expect(parseCommsUrl(url)).toEqual(expected)
    })

    it.each([
        ['inbox root URL', 'https://comms.todoist.com/12345/inbox'],
        ['inbox done URL', 'https://comms.todoist.com/12345/inbox/done'],
        [
            'inbox done thread-like URL',
            'https://comms.todoist.com/12345/inbox/done/t/CeRAj1WU3YFhsVZGDyPr9',
        ],
        ['missing thread id', 'https://comms.todoist.com/12345/inbox/t'],
        ['missing comment id', 'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/c'],
        ['comment-only path', 'https://comms.todoist.com/12345/inbox/c/CeRAj1WU3YFhsY6fUxMhj'],
        [
            'wrong marker after thread id',
            'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/x/CeRAj1WU3YFhsY6fUxMhj',
        ],
        [
            'extra segment after thread id',
            'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/extra',
        ],
        [
            'extra segment after comment id',
            'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj/extra',
        ],
        [
            'msg suffix after thread id',
            'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/msg/CeRAj1WU3YFhsatbAs43L',
        ],
        [
            'saved URL with extra segment',
            'https://comms.todoist.com/12345/saved/t/CeRAj1WU3YFhsVZGDyPr9/extra',
        ],
    ])('leaves %s workspace-only', (_description, url) => {
        expect(parseCommsUrl(url)).toEqual({ workspaceId: 12345 })
    })

    it('parses conversation URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345/msg/CeRAj1WU3YFhsatbAs43L')
        expect(result).toEqual({ workspaceId: 12345, conversationId: 'CeRAj1WU3YFhsatbAs43L' })
    })

    it('parses short conversation URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/12345/msg/CeRAj1WU3YFhsatbAs43L')
        expect(result).toEqual({ workspaceId: 12345, conversationId: 'CeRAj1WU3YFhsatbAs43L' })
    })

    it('parses message URL', () => {
        const result = parseCommsUrl(
            'https://comms.todoist.com/a/12345/msg/CeRAj1WU3YFhsatbAs43L/m/CeRAj1WU3YFhsbp9GT1ir',
        )
        expect(result).toEqual({
            workspaceId: 12345,
            conversationId: 'CeRAj1WU3YFhsatbAs43L',
            messageId: 'CeRAj1WU3YFhsbp9GT1ir',
        })
    })

    it('parses short message URL', () => {
        const result = parseCommsUrl(
            'https://comms.todoist.com/12345/msg/CeRAj1WU3YFhsatbAs43L/m/CeRAj1WU3YFhsbp9GT1ir',
        )
        expect(result).toEqual({
            workspaceId: 12345,
            conversationId: 'CeRAj1WU3YFhsatbAs43L',
            messageId: 'CeRAj1WU3YFhsbp9GT1ir',
        })
    })

    it('parses staging URLs', () => {
        const result = parseCommsUrl(
            'https://comms.staging.todoist.com/12345/msg/CeRAj1WU3YFhsatbAs43L',
        )
        expect(result).toEqual({ workspaceId: 12345, conversationId: 'CeRAj1WU3YFhsatbAs43L' })
    })

    it('parses local URLs', () => {
        const result = parseCommsUrl(
            'https://comms.local.todoist.com/12345/msg/CeRAj1WU3YFhsatbAs43L',
        )
        expect(result).toEqual({ workspaceId: 12345, conversationId: 'CeRAj1WU3YFhsatbAs43L' })
    })

    it('returns null for non-Comms URLs', () => {
        expect(parseCommsUrl('https://google.com')).toBeNull()
        expect(parseCommsUrl('https://example.com/a/123')).toBeNull()
    })

    it('returns null for unsupported protocols', () => {
        expect(parseCommsUrl('ftp://comms.todoist.com/12345/msg/CeRAj1WU3YFhsatbAs43L')).toBeNull()
    })

    it('returns null for invalid URLs', () => {
        expect(parseCommsUrl('not-a-url')).toBeNull()
    })
})

describe('parseRef', () => {
    it('parses id: refs', () => {
        expect(parseRef('id:123')).toEqual({ type: 'id', id: '123' })
    })

    it('parses bare numbers', () => {
        expect(parseRef('456')).toEqual({ type: 'id', id: '456' })
    })

    it('parses base58 IDs', () => {
        expect(parseRef('CeRAj1WU3YFhsTejuePLW')).toEqual({
            type: 'id',
            id: 'CeRAj1WU3YFhsTejuePLW',
        })
    })

    it('keeps all-letter generated IDs out of global name parsing', () => {
        expect(parseRef('CbjxNkWHJBwcaVkoTCRgM')).toEqual({
            type: 'name',
            name: 'CbjxNkWHJBwcaVkoTCRgM',
        })
    })

    it('parses URLs', () => {
        const result = parseRef(
            'https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
        )
        expect(result).toEqual({
            type: 'url',
            parsed: {
                workspaceId: 12345,
                channelId: 'CeRAj1WU3YFhsTejuePLW',
                threadId: 'CeRAj1WU3YFhsVZGDyPr9',
            },
        })
    })

    it('parses names', () => {
        expect(parseRef('My Workspace')).toEqual({ type: 'name', name: 'My Workspace' })
    })

    it('trims surrounding whitespace', () => {
        expect(parseRef(' 456 ')).toEqual({ type: 'id', id: '456' })
        expect(parseRef('  My Workspace  ')).toEqual({ type: 'name', name: 'My Workspace' })
    })
})

describe('getDirectChannelId', () => {
    it('returns ids and channel URL ids', () => {
        expect(getDirectChannelId('id:CeRAj1WU3YFhsTejuePLW')).toBe('CeRAj1WU3YFhsTejuePLW')
        expect(getDirectChannelId('CeRAj1WU3YFhsTejuePLW')).toBe('CeRAj1WU3YFhsTejuePLW')
        expect(
            getDirectChannelId(
                'https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
            ),
        ).toBe('CeRAj1WU3YFhsTejuePLW')
    })

    it('returns null for fuzzy names', () => {
        expect(getDirectChannelId('Engineering')).toBeNull()
    })

    it('rejects URLs that do not identify a channel', () => {
        expect(() =>
            getDirectChannelId('https://comms.todoist.com/a/12345/msg/CeRAj1WU3YFhsatbAs43L'),
        ).toThrow('Invalid channel reference')
    })
})

describe('resolveThreadId', () => {
    it('resolves id: refs', () => {
        expect(resolveThreadId('id:CeRAj1WU3YFhsVZGDyPr9')).toBe('CeRAj1WU3YFhsVZGDyPr9')
    })

    it('resolves base58 ids', () => {
        expect(resolveThreadId('CeRAj1WU3YFhsTejuePLW')).toBe('CeRAj1WU3YFhsTejuePLW')
    })

    it('resolves generated Comms IDs without digits', () => {
        expect(resolveThreadId('CbjxNkWHJBwcaVkoTCRgM')).toBe('CbjxNkWHJBwcaVkoTCRgM')
    })

    it.each([
        [
            'thread URL',
            'https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
        ],
        [
            'thread URL with comment suffix',
            'https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
        ],
        ['inbox thread URL', 'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/'],
        [
            'inbox thread URL with comment suffix',
            'https://comms.todoist.com/12345/inbox/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
        ],
        ['saved thread URL', 'https://comms.todoist.com/12345/saved/t/CeRAj1WU3YFhsVZGDyPr9'],
        [
            'saved thread URL with comment suffix',
            'https://comms.todoist.com/12345/saved/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
        ],
    ])('resolves %s', (_description, url) => {
        expect(resolveThreadId(url)).toBe('CeRAj1WU3YFhsVZGDyPr9')
    })

    it('throws on invalid refs', () => {
        expect(() => resolveThreadId('invalid name')).toThrow('Invalid thread reference')
    })
})

describe('resolveCommentId', () => {
    it('resolves id: refs', () => {
        expect(resolveCommentId('id:CeRAj1WU3YFhsY6fUxMhj')).toBe('CeRAj1WU3YFhsY6fUxMhj')
    })

    it('resolves comment URLs', () => {
        expect(
            resolveCommentId(
                'https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            ),
        ).toBe('CeRAj1WU3YFhsY6fUxMhj')
    })
})

describe('resolveChannelId', () => {
    it('resolves id: refs', () => {
        expect(resolveChannelId('id:CeRAj1WU3YFhsTejuePLW')).toBe('CeRAj1WU3YFhsTejuePLW')
    })

    it('resolves channel URLs', () => {
        expect(resolveChannelId('https://comms.todoist.com/a/12345/ch/CeRAj1WU3YFhsTejuePLW')).toBe(
            'CeRAj1WU3YFhsTejuePLW',
        )
    })
})

describe('resolveChannelRef', () => {
    function createChannel(id: string, name: string, overrides: Record<string, unknown> = {}) {
        return {
            id,
            name,
            public: true,
            workspaceId: 1,
            archived: false,
            creator: 1,
            created: new Date('2026-01-01T00:00:00Z'),
            version: 1,
            ...overrides,
        }
    }

    const mockGetChannel = vi.fn()
    const mockGetChannels = vi.fn()
    const mockGetPublicChannels = vi.fn()

    /**
     * For name refs, resolveChannelRef merges joined channels (getChannels — membership-scoped,
     * includes both active + archived) with public channels (getPublicChannels — workspace-scoped,
     * finds unjoined-but-public channels). Tests default both to empty unless overridden.
     */
    function mockChannelLists(joined: unknown[] = [], publicChannels: unknown[] = []) {
        mockGetChannels.mockResolvedValue(joined)
        mockGetPublicChannels.mockResolvedValue(publicChannels)
    }

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCommsClient.mockResolvedValue({
            channels: {
                getChannel: mockGetChannel,
                getChannels: mockGetChannels,
            },
            workspaces: {
                getPublicChannels: mockGetPublicChannels,
            },
        })
    })

    it('fetches channel by id: ref via getChannel', async () => {
        const ch = createChannel('CeRAj1WU3YFhsTejuePLW', 'engineering')
        mockGetChannel.mockResolvedValue(ch)

        const result = await resolveChannelRef('id:CeRAj1WU3YFhsTejuePLW', 1)

        expect(mockGetChannel).toHaveBeenCalledWith('CeRAj1WU3YFhsTejuePLW')
        expect(mockGetChannels).not.toHaveBeenCalled()
        expect(result).toEqual(ch)
    })

    it('fetches channel by Comms URL via getChannel', async () => {
        const ch = createChannel('CeRAj1WU3YFhsTejuePLW', 'engineering')
        mockGetChannel.mockResolvedValue(ch)

        const result = await resolveChannelRef(
            'https://comms.todoist.com/a/1/ch/CeRAj1WU3YFhsTejuePLW',
            1,
        )

        expect(mockGetChannel).toHaveBeenCalledWith('CeRAj1WU3YFhsTejuePLW')
        expect(result).toEqual(ch)
    })

    it('throws CHANNEL_NOT_FOUND when id: ref resolves to a channel in another workspace', async () => {
        mockGetChannel.mockResolvedValue(
            createChannel('CeRAj1WU3YFhsTejuePLW', 'engineering', { workspaceId: 2 }),
        )

        await expect(resolveChannelRef('id:CeRAj1WU3YFhsTejuePLW', 1)).rejects.toHaveProperty(
            'code',
            'CHANNEL_NOT_FOUND',
        )
    })

    it('throws CHANNEL_NOT_FOUND when URL workspaceId conflicts with expected workspaceId', async () => {
        await expect(
            resolveChannelRef('https://comms.todoist.com/a/2/ch/CeRAj1WU3YFhsTejuePLW', 1),
        ).rejects.toHaveProperty('code', 'CHANNEL_NOT_FOUND')
        expect(mockGetChannel).not.toHaveBeenCalled()
    })

    it('resolves exact case-insensitive name match against joined channels without fetching public list', async () => {
        const ch = createChannel('CHGEN', 'General')
        mockChannelLists([ch, createChannel('CHLEAD', 'Leadership')])

        const result = await resolveChannelRef('general', 1)

        expect(result).toEqual(ch)
        // Common case: exact match in joined list short-circuits before the
        // workspace-wide getPublicChannels call.
        expect(mockGetPublicChannels).not.toHaveBeenCalled()
    })

    it('resolves unique substring name match', async () => {
        const ch = createChannel('CHMKT', 'Marketing')
        mockChannelLists([createChannel('CHGEN', 'General'), ch])

        const result = await resolveChannelRef('market', 1)

        expect(result).toEqual(ch)
    })

    it('throws AMBIGUOUS_CHANNEL on multiple substring matches', async () => {
        mockChannelLists([
            createChannel('CHENG', 'Engineering'),
            createChannel('CHEOP', 'Engineering-Ops'),
        ])

        await expect(resolveChannelRef('eng', 1)).rejects.toHaveProperty(
            'code',
            'AMBIGUOUS_CHANNEL',
        )
    })

    it('throws CHANNEL_NOT_FOUND when no match', async () => {
        mockChannelLists([createChannel('CHGEN', 'General')])

        await expect(resolveChannelRef('nope', 1)).rejects.toHaveProperty(
            'code',
            'CHANNEL_NOT_FOUND',
        )
    })

    it('resolves unjoined-but-public channel by name', async () => {
        const publicCh = createChannel('CHPUB1', 'Old Public Channel')
        mockChannelLists([createChannel('CHGEN', 'General')], [publicCh])

        const result = await resolveChannelRef('Old Public Channel', 1)

        expect(result).toEqual(publicCh)
    })

    it('resolves unjoined-but-public channel by substring', async () => {
        const publicCh = createChannel('CHSMOKE', 'tw-cli-smoke-test-channel')
        mockChannelLists([createChannel('CHGEN', 'General')], [publicCh])

        const result = await resolveChannelRef('smoke-test', 1)

        expect(result).toEqual(publicCh)
    })

    it('deduplicates channels appearing in both joined and public lists', async () => {
        // A public channel the user has joined appears in both responses. Use distinct
        // object instances with the same id — that's what two API calls actually return,
        // and it ensures dedupe is by id (not reference equality). A substring query
        // exercises the dedupe step: without it, matchByName sees two partial matches
        // for the same channel id and throws AMBIGUOUS_CHANNEL. An exact-match query
        // wouldn't catch a regression because matchByName returns on the first .find.
        const joinedCopy = createChannel('CHJP', 'Engineering', { public: true })
        const publicCopy = createChannel('CHJP', 'Engineering', { public: true })
        mockChannelLists([joinedCopy], [publicCopy])

        const result = await resolveChannelRef('eng', 1)

        expect(result).toEqual(joinedCopy)
    })

    it('throws AMBIGUOUS_CHANNEL on substring matches spanning joined and public lists', async () => {
        mockChannelLists(
            [createChannel('CHENG', 'Engineering')],
            [createChannel('CHEOP', 'Engineering-Ops')],
        )

        await expect(resolveChannelRef('eng', 1)).rejects.toHaveProperty(
            'code',
            'AMBIGUOUS_CHANNEL',
        )
    })
})

describe('resolveConversationId', () => {
    it('resolves id: refs', () => {
        expect(resolveConversationId('id:CeRAj1WU3YFhsatbAs43L')).toBe('CeRAj1WU3YFhsatbAs43L')
    })

    it('resolves conversation URLs', () => {
        expect(
            resolveConversationId('https://comms.todoist.com/a/12345/msg/CeRAj1WU3YFhsatbAs43L'),
        ).toBe('CeRAj1WU3YFhsatbAs43L')
    })
})

describe('resolveMessageId', () => {
    it('resolves id: refs', () => {
        expect(resolveMessageId('id:CeRAj1WU3YFhsbp9GT1ir')).toBe('CeRAj1WU3YFhsbp9GT1ir')
    })

    it('resolves message URLs', () => {
        expect(
            resolveMessageId(
                'https://comms.todoist.com/a/12345/msg/CeRAj1WU3YFhsatbAs43L/m/CeRAj1WU3YFhsbp9GT1ir',
            ),
        ).toBe('CeRAj1WU3YFhsbp9GT1ir')
    })
})

describe('partitionNotifyIds', () => {
    it('separates user IDs from group IDs', () => {
        const groupIds = new Set(['GR1', 'GR2'])
        const result = partitionNotifyIds(['1', 'GR1', '2', 'GR2', '3'], groupIds)
        expect(result.userIds).toEqual([1, 2, 3])
        expect(result.groupIds).toEqual(['GR1', 'GR2'])
    })

    it('returns all as users when no groups match', () => {
        const groupIds = new Set<string>(['GR99'])
        const result = partitionNotifyIds(['1', '2', '3'], groupIds)
        expect(result.userIds).toEqual([1, 2, 3])
        expect(result.groupIds).toEqual([])
    })

    it('returns all as groups when all match', () => {
        const groupIds = new Set(['GR1', 'GR2', 'GR3'])
        const result = partitionNotifyIds(['GR1', 'GR2', 'GR3'], groupIds)
        expect(result.userIds).toEqual([])
        expect(result.groupIds).toEqual(['GR1', 'GR2', 'GR3'])
    })

    it('handles empty input', () => {
        const result = partitionNotifyIds([], new Set(['GR1']))
        expect(result.userIds).toEqual([])
        expect(result.groupIds).toEqual([])
    })

    it('rejects non-numeric, non-group ids as malformed user refs', () => {
        const groupIds = new Set(['GR1'])
        expect(() => partitionNotifyIds(['abcxyz'], groupIds)).toThrow('Invalid notify ID')
    })
})

describe('classifyCommsUrl', () => {
    it.each([
        [
            'thread URL',
            'https://comms.todoist.com/a/20/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
            'thread',
        ],
        [
            'thread+comment URL',
            'https://comms.todoist.com/a/20/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            'comment',
        ],
        [
            'inbox thread URL',
            'https://comms.todoist.com/20/inbox/t/CeRAj1WU3YFhsVZGDyPr9/',
            'thread',
        ],
        [
            'inbox thread+comment URL',
            'https://comms.todoist.com/20/inbox/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            'comment',
        ],
        [
            'saved thread URL',
            'https://comms.todoist.com/20/saved/t/CeRAj1WU3YFhsVZGDyPr9',
            'thread',
        ],
        [
            'saved thread+comment URL',
            'https://comms.todoist.com/20/saved/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            'comment',
        ],
        [
            'conversation URL',
            'https://comms.todoist.com/a/20/msg/CeRAj1WU3YFhsatbAs43L',
            'conversation',
        ],
        [
            'short conversation URL',
            'https://comms.todoist.com/20/msg/CeRAj1WU3YFhsatbAs43L',
            'conversation',
        ],
        [
            'message URL',
            'https://comms.todoist.com/a/20/msg/CeRAj1WU3YFhsatbAs43L/m/CeRAj1WU3YFhsbp9GT1ir',
            'message',
        ],
    ] as const)('classifies %s', (_description, url, entityType) => {
        expect(classifyCommsUrl(url)).toEqual({ entityType, url })
    })

    it.each([
        ['inbox root URL', 'https://comms.todoist.com/20/inbox'],
        ['inbox done URL', 'https://comms.todoist.com/20/inbox/done'],
        [
            'inbox done thread-like URL',
            'https://comms.todoist.com/20/inbox/done/t/CeRAj1WU3YFhsVZGDyPr9',
        ],
        [
            'inbox thread with extra segment',
            'https://comms.todoist.com/20/inbox/t/CeRAj1WU3YFhsVZGDyPr9/extra',
        ],
        [
            'inbox thread with msg suffix',
            'https://comms.todoist.com/20/inbox/t/CeRAj1WU3YFhsVZGDyPr9/msg/CeRAj1WU3YFhsatbAs43L',
        ],
        [
            'saved thread with extra segment',
            'https://comms.todoist.com/20/saved/t/CeRAj1WU3YFhsVZGDyPr9/extra',
        ],
        ['workspace-only URL', 'https://comms.todoist.com/a/20'],
        ['channel-only URL', 'https://comms.todoist.com/a/20/ch/CeRAj1WU3YFhsTejuePLW'],
        [
            'malformed account URL',
            'https://comms.todoist.com/a/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
        ],
        ['non-Comms URL', 'https://google.com/a/20/t/200'],
        ['invalid string', 'not-a-url'],
    ])('returns null for %s', (_description, url) => {
        expect(classifyCommsUrl(url)).toBeNull()
    })
})

describe('resolveGroupRef', () => {
    const sampleGroups = [
        {
            id: 'GR100',
            name: 'Frontend',
            workspaceId: 1,
            userIds: [1, 2],
            description: '',
            version: 1,
        },
        {
            id: 'GR200',
            name: 'Backend',
            workspaceId: 1,
            userIds: [3],
            description: '',
            version: 1,
        },
        {
            id: 'GR300',
            name: 'Frontend Leads',
            workspaceId: 1,
            userIds: [1],
            description: '',
            version: 1,
        },
    ]

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getWorkspaceGroups.mockResolvedValue(sampleGroups)
        apiMocks.getGroup.mockImplementation(async (id: string) => {
            const group = sampleGroups.find((g) => g.id === id)
            if (!group) throw new Error(`Group ${id} not found`)
            return group
        })
    })

    it('resolves by raw ID via getGroup', async () => {
        const group = await resolveGroupRef('GR100', 1)
        expect(group.id).toBe('GR100')
        expect(group.name).toBe('Frontend')
        expect(apiMocks.getGroup).toHaveBeenCalledWith('GR100', 1)
        expect(apiMocks.getWorkspaceGroups).not.toHaveBeenCalled()
    })

    it('resolves by id: prefix via getGroup', async () => {
        const group = await resolveGroupRef('id:GR200', 1)
        expect(group.id).toBe('GR200')
        expect(apiMocks.getGroup).toHaveBeenCalledWith('GR200', 1)
    })

    it('throws GROUP_NOT_FOUND for missing ID', async () => {
        apiMocks.getGroup.mockRejectedValue(new Error('Not found'))
        await expect(resolveGroupRef('id:GR999', 1)).rejects.toMatchObject({
            code: 'GROUP_NOT_FOUND',
        })
    })

    it('throws GROUP_NOT_FOUND when group belongs to different workspace', async () => {
        apiMocks.getGroup.mockResolvedValue({ ...sampleGroups[0], workspaceId: 999 })
        await expect(resolveGroupRef('id:GR100', 1)).rejects.toMatchObject({
            code: 'GROUP_NOT_FOUND',
        })
    })

    it('resolves by exact name (case-insensitive)', async () => {
        const group = await resolveGroupRef('frontend', 1)
        expect(group.id).toBe('GR100')
    })

    it('resolves by unique name substring', async () => {
        const group = await resolveGroupRef('Back', 1)
        expect(group.id).toBe('GR200')
    })

    it('throws AMBIGUOUS_GROUP when name matches multiple groups', async () => {
        await expect(resolveGroupRef('Front', 1)).rejects.toMatchObject({
            code: 'AMBIGUOUS_GROUP',
        })
    })

    it('throws GROUP_NOT_FOUND when name matches nothing', async () => {
        await expect(resolveGroupRef('Marketing', 1)).rejects.toMatchObject({
            code: 'GROUP_NOT_FOUND',
        })
    })
})

describe('resolveUserRefs', () => {
    const sampleUsers = [
        { id: 1, fullName: 'Alice Smith', email: 'alice@doist.com' },
        { id: 2, fullName: 'Bob Jones', email: 'bob@doist.com' },
        { id: 3, fullName: 'Carol Smith', email: 'carol@doist.com' },
    ]

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getWorkspaceUsers.mockResolvedValue(sampleUsers)
    })

    it('resolves a single id: ref', async () => {
        const ids = await resolveUserRefs('id:42', 1)
        expect(ids).toEqual([42])
        expect(apiMocks.getWorkspaceUsers).not.toHaveBeenCalled()
    })

    it('resolves comma-separated mixed refs', async () => {
        const ids = await resolveUserRefs('id:1, bob@doist.com', 1)
        expect(ids).toEqual([1, 2])
    })

    it('throws AMBIGUOUS_USER when name matches multiple', async () => {
        await expect(resolveUserRefs('Smith', 1)).rejects.toMatchObject({
            code: 'AMBIGUOUS_USER',
        })
    })

    it('throws USER_NOT_FOUND for unknown name', async () => {
        await expect(resolveUserRefs('nobody', 1)).rejects.toMatchObject({
            code: 'USER_NOT_FOUND',
        })
    })
})

describe('resolveChannelMemberRefs', () => {
    const sampleGroups = [
        {
            id: 'GR100',
            name: 'Frontend',
            workspaceId: 1,
            userIds: [1, 2],
            description: '',
            version: 1,
        },
        {
            id: 'GR200',
            name: 'Backend',
            workspaceId: 1,
            userIds: [3, 4],
            description: '',
            version: 1,
        },
    ]
    const sampleUsers = [
        { id: 1, fullName: 'Alice', email: 'alice@doist.com' },
        { id: 2, fullName: 'Bob', email: 'bob@doist.com' },
        { id: 3, fullName: 'Carol', email: 'carol@doist.com' },
    ]

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getWorkspaceUsers.mockResolvedValue(sampleUsers)
        apiMocks.getWorkspaceGroups.mockResolvedValue(sampleGroups)
        apiMocks.getGroup.mockImplementation(async (id: string) => {
            const group = sampleGroups.find((g) => g.id === id)
            if (!group) throw new Error(`Group ${id} not found`)
            return group
        })
    })

    it('throws MISSING_USERS for an empty ref list', async () => {
        await expect(resolveChannelMemberRefs([], 1)).rejects.toMatchObject({
            code: 'MISSING_USERS',
        })
    })

    it('preserves input order and dedupes across users and group expansion', async () => {
        const { userIds, expandedFrom } = await resolveChannelMemberRefs(
            ['id:3', 'group:Frontend', 'id:1'],
            1,
        )
        // 3 first, then group expands to 1,2 (3 already seen stays put), 1 already seen
        expect(userIds).toEqual([3, 1, 2])
        expect(expandedFrom).toEqual([{ groupId: 'GR100', groupName: 'Frontend', userIds: [1, 2] }])
    })

    it('accepts a case-insensitive group: prefix', async () => {
        const { userIds, expandedFrom } = await resolveChannelMemberRefs(['GROUP:Frontend'], 1)
        expect(userIds).toEqual([1, 2])
        expect(expandedFrom).toHaveLength(1)
    })

    it('preserves order across interleaved users and multiple groups', async () => {
        const { userIds, expandedFrom } = await resolveChannelMemberRefs(
            ['id:5', 'group:Frontend', 'id:1', 'group:Backend'],
            1,
        )
        // 5, then Frontend → 1,2 (1 dedup'd later), then Backend → 3,4
        expect(userIds).toEqual([5, 1, 2, 3, 4])
        expect(expandedFrom).toEqual([
            { groupId: 'GR100', groupName: 'Frontend', userIds: [1, 2] },
            { groupId: 'GR200', groupName: 'Backend', userIds: [3, 4] },
        ])
    })

    it('rejects an empty group: reference', async () => {
        await expect(resolveChannelMemberRefs(['group:'], 1)).rejects.toMatchObject({
            code: 'INVALID_REF',
        })
    })
})

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
        expect(extractId('7YpL3oZ4kZ9vP7Q1tR2sX3z')).toBe('7YpL3oZ4kZ9vP7Q1tR2sX3z')
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
        expect(looksLikeRawId('7YpL3oZ4kZ9vP7Q1tR2sX3z')).toBe(true)
    })

    it('rejects plain names and spaces', () => {
        expect(looksLikeRawId('workspace')).toBe(false)
        expect(looksLikeRawId('workspace one')).toBe(false)
    })
})

describe('parseCommsUrl', () => {
    it('parses workspace URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345')
        expect(result).toEqual({ workspaceId: 12345 })
    })

    it('parses channel URL with base58 id', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345/ch/7YpL3oZ4kZ9vP7Q1tR2sX3z')
        expect(result).toEqual({ workspaceId: 12345, channelId: '7YpL3oZ4kZ9vP7Q1tR2sX3z' })
    })

    it('parses thread URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345/ch/CH1/t/TH1')
        expect(result).toEqual({ workspaceId: 12345, channelId: 'CH1', threadId: 'TH1' })
    })

    it('parses thread with comment URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345/ch/CH1/t/TH1/c/CM1')
        expect(result).toEqual({
            workspaceId: 12345,
            channelId: 'CH1',
            threadId: 'TH1',
            commentId: 'CM1',
        })
    })

    it('parses conversation URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345/msg/CV1')
        expect(result).toEqual({ workspaceId: 12345, conversationId: 'CV1' })
    })

    it('parses message URL', () => {
        const result = parseCommsUrl('https://comms.todoist.com/a/12345/msg/CV1/m/MS1')
        expect(result).toEqual({ workspaceId: 12345, conversationId: 'CV1', messageId: 'MS1' })
    })

    it('returns null for non-Comms URLs', () => {
        expect(parseCommsUrl('https://google.com')).toBeNull()
        expect(parseCommsUrl('https://example.com/a/123')).toBeNull()
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
        expect(parseRef('7YpL3oZ4kZ9vP7Q1tR2sX3z')).toEqual({
            type: 'id',
            id: '7YpL3oZ4kZ9vP7Q1tR2sX3z',
        })
    })

    it('parses URLs', () => {
        const result = parseRef('https://comms.todoist.com/a/12345/ch/CH1/t/TH1')
        expect(result).toEqual({
            type: 'url',
            parsed: { workspaceId: 12345, channelId: 'CH1', threadId: 'TH1' },
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
        expect(getDirectChannelId('id:CH1')).toBe('CH1')
        expect(getDirectChannelId('CH1')).toBe('CH1')
        expect(getDirectChannelId('https://comms.todoist.com/a/12345/ch/CH1/t/TH1')).toBe('CH1')
    })

    it('returns null for fuzzy names', () => {
        expect(getDirectChannelId('Engineering')).toBeNull()
    })

    it('rejects URLs that do not identify a channel', () => {
        expect(() => getDirectChannelId('https://comms.todoist.com/a/12345/msg/CV1')).toThrow(
            'Invalid channel reference',
        )
    })
})

describe('resolveThreadId', () => {
    it('resolves id: refs', () => {
        expect(resolveThreadId('id:TH1')).toBe('TH1')
    })

    it('resolves base58 ids', () => {
        expect(resolveThreadId('7YpL3oZ4kZ9vP7Q1tR2sX3z')).toBe('7YpL3oZ4kZ9vP7Q1tR2sX3z')
    })

    it('resolves thread URLs', () => {
        expect(resolveThreadId('https://comms.todoist.com/a/12345/ch/CH1/t/TH1')).toBe('TH1')
    })

    it('resolves thread URLs with comment suffix', () => {
        expect(resolveThreadId('https://comms.todoist.com/a/12345/ch/CH1/t/TH1/c/CM1')).toBe('TH1')
    })

    it('throws on invalid refs', () => {
        expect(() => resolveThreadId('invalid name')).toThrow('Invalid thread reference')
    })
})

describe('resolveCommentId', () => {
    it('resolves id: refs', () => {
        expect(resolveCommentId('id:CM1')).toBe('CM1')
    })

    it('resolves comment URLs', () => {
        expect(resolveCommentId('https://comms.todoist.com/a/12345/ch/CH1/t/TH1/c/CM1')).toBe('CM1')
    })
})

describe('resolveChannelId', () => {
    it('resolves id: refs', () => {
        expect(resolveChannelId('id:CH1')).toBe('CH1')
    })

    it('resolves channel URLs', () => {
        expect(resolveChannelId('https://comms.todoist.com/a/12345/ch/CH1')).toBe('CH1')
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

    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCommsClient.mockResolvedValue({
            channels: {
                getChannel: mockGetChannel,
                getChannels: mockGetChannels,
            },
        })
    })

    it('fetches channel by id: ref via getChannel', async () => {
        const ch = createChannel('CH1', 'engineering')
        mockGetChannel.mockResolvedValue(ch)

        const result = await resolveChannelRef('id:CH1', 1)

        expect(mockGetChannel).toHaveBeenCalledWith('CH1')
        expect(mockGetChannels).not.toHaveBeenCalled()
        expect(result).toEqual(ch)
    })

    it('fetches channel by Comms URL via getChannel', async () => {
        const ch = createChannel('CH1', 'engineering')
        mockGetChannel.mockResolvedValue(ch)

        const result = await resolveChannelRef('https://comms.todoist.com/a/1/ch/CH1', 1)

        expect(mockGetChannel).toHaveBeenCalledWith('CH1')
        expect(result).toEqual(ch)
    })

    it('throws CHANNEL_NOT_FOUND when id: ref resolves to a channel in another workspace', async () => {
        mockGetChannel.mockResolvedValue(createChannel('CH1', 'engineering', { workspaceId: 2 }))

        await expect(resolveChannelRef('id:CH1', 1)).rejects.toHaveProperty(
            'code',
            'CHANNEL_NOT_FOUND',
        )
    })

    it('throws CHANNEL_NOT_FOUND when URL workspaceId conflicts with expected workspaceId', async () => {
        await expect(
            resolveChannelRef('https://comms.todoist.com/a/2/ch/CH1', 1),
        ).rejects.toHaveProperty('code', 'CHANNEL_NOT_FOUND')
        expect(mockGetChannel).not.toHaveBeenCalled()
    })

    it('resolves exact case-insensitive name match', async () => {
        const ch = createChannel('CHGEN', 'General')
        mockGetChannels.mockResolvedValue([ch, createChannel('CHLEAD', 'Leadership')])

        const result = await resolveChannelRef('general', 1)

        expect(mockGetChannels).toHaveBeenCalledWith({ workspaceId: 1 })
        expect(result).toEqual(ch)
    })

    it('resolves unique substring name match', async () => {
        const ch = createChannel('CHMKT', 'Marketing')
        mockGetChannels.mockResolvedValue([createChannel('CHGEN', 'General'), ch])

        const result = await resolveChannelRef('market', 1)

        expect(result).toEqual(ch)
    })

    it('throws AMBIGUOUS_CHANNEL on multiple substring matches', async () => {
        mockGetChannels.mockResolvedValue([
            createChannel('CHENG', 'Engineering'),
            createChannel('CHEOP', 'Engineering-Ops'),
        ])

        await expect(resolveChannelRef('eng', 1)).rejects.toHaveProperty(
            'code',
            'AMBIGUOUS_CHANNEL',
        )
    })

    it('throws CHANNEL_NOT_FOUND when no match', async () => {
        mockGetChannels.mockResolvedValue([createChannel('CHGEN', 'General')])

        await expect(resolveChannelRef('nope', 1)).rejects.toHaveProperty(
            'code',
            'CHANNEL_NOT_FOUND',
        )
    })
})

describe('resolveConversationId', () => {
    it('resolves id: refs', () => {
        expect(resolveConversationId('id:CV1')).toBe('CV1')
    })

    it('resolves conversation URLs', () => {
        expect(resolveConversationId('https://comms.todoist.com/a/12345/msg/CV1')).toBe('CV1')
    })
})

describe('resolveMessageId', () => {
    it('resolves id: refs', () => {
        expect(resolveMessageId('id:MS1')).toBe('MS1')
    })

    it('resolves message URLs', () => {
        expect(resolveMessageId('https://comms.todoist.com/a/12345/msg/CV1/m/MS1')).toBe('MS1')
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
    it('classifies thread URL', () => {
        expect(classifyCommsUrl('https://comms.todoist.com/a/20/ch/CH1/t/TH1')).toEqual({
            entityType: 'thread',
            url: 'https://comms.todoist.com/a/20/ch/CH1/t/TH1',
        })
    })

    it('classifies thread+comment URL as comment', () => {
        expect(classifyCommsUrl('https://comms.todoist.com/a/20/ch/CH1/t/TH1/c/CM1')).toEqual({
            entityType: 'comment',
            url: 'https://comms.todoist.com/a/20/ch/CH1/t/TH1/c/CM1',
        })
    })

    it('classifies conversation URL', () => {
        expect(classifyCommsUrl('https://comms.todoist.com/a/20/msg/CV1')).toEqual({
            entityType: 'conversation',
            url: 'https://comms.todoist.com/a/20/msg/CV1',
        })
    })

    it('classifies message URL', () => {
        expect(classifyCommsUrl('https://comms.todoist.com/a/20/msg/CV1/m/MS1')).toEqual({
            entityType: 'message',
            url: 'https://comms.todoist.com/a/20/msg/CV1/m/MS1',
        })
    })

    it('returns null for workspace-only URL', () => {
        expect(classifyCommsUrl('https://comms.todoist.com/a/20')).toBeNull()
    })

    it('returns null for channel-only URL', () => {
        expect(classifyCommsUrl('https://comms.todoist.com/a/20/ch/CH1')).toBeNull()
    })

    it('returns null for non-Comms URL', () => {
        expect(classifyCommsUrl('https://google.com/a/20/t/200')).toBeNull()
    })

    it('returns null for invalid string', () => {
        expect(classifyCommsUrl('not-a-url')).toBeNull()
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

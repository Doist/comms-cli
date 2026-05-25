import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
}))

vi.mock('../../lib/public-channels.js', () => ({
    assertChannelIsPublic: vi.fn(),
}))

vi.mock('../../lib/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/api.js')>()),
    getCommsClient: apiMocks.getCommsClient,
}))

vi.mock('../../lib/input.js', () => ({
    readStdin: vi.fn().mockResolvedValue(''),
    openEditor: vi.fn().mockResolvedValue(''),
}))

vi.mock('../../lib/markdown.js', () => ({
    renderMarkdown: vi.fn((text: string) => Promise.resolve(text)),
}))

vi.mock('chalk')

import { readStdin } from '../../lib/input.js'
import { registerCommentCommand } from './index.js'

function createCommentFixture(id: string, creator = 1) {
    return {
        id,
        content: `Comment ${id}`,
        creator,
        threadId: 'TH500',
        channelId: 'CH100',
        workspaceId: 10,
        posted: new Date('2026-03-02T00:00:00.000Z'),
        reactions: [],
        url: `https://comms.todoist.com/a/10/ch/CH100/t/TH500/c/${id}`,
    }
}

function createClient({ commentCreator = 1, sessionUserId = 1 } = {}) {
    return {
        comments: {
            getComment: vi.fn(async (id: string) => createCommentFixture(id, commentCreator)),
            updateComment: vi.fn(async (args: { id: string; content: string }) => ({
                ...createCommentFixture(args.id, commentCreator),
                content: args.content,
            })),
            deleteComment: vi.fn(async () => undefined),
        },
        users: {
            getSessionUser: vi.fn(async () => ({ id: sessionUserId, fullName: 'Me' })),
        },
        workspaceUsers: {
            getUserById: vi.fn(async () => ({ id: commentCreator, fullName: 'Bob' })),
        },
    }
}

const createProgram = () => createTestProgram(registerCommentCommand)

describe('comment implicit view', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCommsClient.mockRejectedValue(new Error('MOCK_API_REACHED'))
    })

    it('tdc comment <ref> routes to view (not unknown command)', async () => {
        const program = createProgram()
        captureConsole('log')

        await expect(program.parseAsync(['node', 'tdc', 'comment', '300'])).rejects.toThrow(
            'MOCK_API_REACHED',
        )
    })
})

describe('comment view', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('views a comment', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'view', '300'])

        expect(client.comments.getComment).toHaveBeenCalledWith('300')
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Comment 300'))
    })

    it('outputs JSON with --json', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'view', '300', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe('300')
        expect(jsonOutput.content).toBe('Comment 300')
    })

    it('outputs NDJSON with --ndjson', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'view', '300', '--ndjson'])

        const line = consoleSpy.mock.calls[0][0]
        expect(line).not.toContain('\n')
        const parsed = JSON.parse(line)
        expect(parsed.id).toBe('300')
        expect(parsed.content).toBe('Comment 300')
    })

    it('includes creatorName in --json --full output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'view', '300', '--json', '--full'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe('300')
        expect(jsonOutput.creatorName).toBe('Bob')
    })
})

describe('comment update', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('updates a comment with positional content', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'update', '300', 'Updated content'])

        expect(client.comments.updateComment).toHaveBeenCalledWith({
            id: '300',
            content: 'Updated content',
        })
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Comment updated:'))
    })

    it('shows dry run output', async () => {
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'comment',
            'update',
            '300',
            'New content',
            '--dry-run',
        ])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would update comment'))
        expect(consoleSpy).toHaveBeenCalledWith('  Comment: 300')
        expect(consoleSpy).toHaveBeenCalledWith('  Content: New content')
    })

    it('outputs JSON with --json', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'update', '300', 'Updated', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput.id).toBe('300')
        expect(jsonOutput.content).toBe('Updated')
    })

    it('reads content from stdin', async () => {
        vi.mocked(readStdin).mockResolvedValueOnce('Content from stdin')
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'update', '300'])

        expect(client.comments.updateComment).toHaveBeenCalledWith({
            id: '300',
            content: 'Content from stdin',
        })
    })

    it('errors when no content is provided', async () => {
        const program = createProgram()
        captureConsole('log')

        await expect(
            program.parseAsync(['node', 'tdc', 'comment', 'update', '300']),
        ).rejects.toHaveProperty('code', 'MISSING_CONTENT')
    })
})

describe('comment delete', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('deletes a comment', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'delete', '300'])

        expect(client.comments.deleteComment).toHaveBeenCalledWith('300')
        expect(consoleSpy).toHaveBeenCalledWith('Comment 300 deleted.')
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'delete', '300', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would delete comment'))
        expect(consoleSpy).toHaveBeenCalledWith('  Comment: 300')
        expect(consoleSpy).toHaveBeenCalledWith('  Thread: TH500')
        expect(client.comments.deleteComment).not.toHaveBeenCalled()
    })

    it('rejects non-creator with NOT_CREATOR in dry-run', async () => {
        const client = createClient({ commentCreator: 99, sessionUserId: 1 })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'comment', 'delete', '300', '--dry-run']),
        ).rejects.toHaveProperty('code', 'NOT_CREATOR')
        expect(client.comments.deleteComment).not.toHaveBeenCalled()
    })

    it('rejects when assertChannelIsPublic throws in dry-run', async () => {
        const { assertChannelIsPublic } = await import('../../lib/public-channels.js')
        vi.mocked(assertChannelIsPublic).mockRejectedValueOnce(new Error('channel is private'))

        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'comment', 'delete', '300', '--dry-run']),
        ).rejects.toThrow('channel is private')
        expect(client.comments.deleteComment).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'comment', 'delete', '300', '--json'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual({ id: '300', deleted: true })
    })
})

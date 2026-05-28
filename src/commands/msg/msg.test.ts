import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
}))

vi.mock('../../lib/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/api.js')>()),
    getCommsClient: apiMocks.getCommsClient,
}))

vi.mock('../../lib/refs.js', () => ({
    resolveMessageId: vi.fn().mockReturnValue('200'),
}))

vi.mock('../../lib/input.js', () => ({
    readStdin: vi.fn().mockResolvedValue(''),
    openEditor: vi.fn().mockResolvedValue(''),
}))

vi.mock('../../lib/markdown.js', () => ({
    renderMarkdown: vi.fn((text: string) => Promise.resolve(text)),
}))

vi.mock('chalk')

import { registerMsgCommand } from './index.js'

function createMessageFixture(id: string, creator = 1) {
    return {
        id,
        content: `Message ${id} body`,
        creator,
        conversationId: 'CV42',
        workspaceId: 10,
        posted: new Date('2026-03-08T00:00:00.000Z'),
        url: `https://comms.todoist.com/a/10/msg/CV42/m/${id}`,
    }
}

function createClient({ messageCreator = 1, sessionUserId = 1 } = {}) {
    return {
        conversationMessages: {
            getMessage: vi.fn(async (id: string) => createMessageFixture(id, messageCreator)),
            deleteMessage: vi.fn(async () => undefined),
            updateMessage: vi.fn(async (args: { id: string; content: string }) => ({
                ...createMessageFixture(args.id, messageCreator),
                content: args.content,
            })),
        },
        users: {
            getSessionUser: vi.fn(async () => ({ id: sessionUserId, fullName: 'Me' })),
        },
        workspaceUsers: {
            getUserById: vi.fn(async () => ({ id: messageCreator, fullName: 'Sender' })),
        },
    }
}

const createProgram = () => createTestProgram(registerMsgCommand)

describe('msg implicit view', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.getCommsClient.mockRejectedValue(new Error('MOCK_API_REACHED'))
    })

    it('tdc msg <ref> routes to view (not unknown command)', async () => {
        const program = createProgram()
        captureConsole('log')

        await expect(program.parseAsync(['node', 'tdc', 'msg', '200'])).rejects.toThrow(
            'MOCK_API_REACHED',
        )
    })
})

describe('msg delete', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('deletes a message with --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'msg', 'delete', '200', '--yes'])

        expect(client.conversationMessages.deleteMessage).toHaveBeenCalledWith('200')
        expect(consoleSpy).toHaveBeenCalledWith('Message 200 deleted.')
    })

    it('prompts for confirmation without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'msg', 'delete', '200'])

        expect(consoleSpy).toHaveBeenCalledWith('Would delete message 200')
        expect(consoleSpy).toHaveBeenCalledWith('Use --yes to confirm.')
        expect(client.conversationMessages.deleteMessage).not.toHaveBeenCalled()
    })

    it('shows dry run output', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'msg', 'delete', '200', '--dry-run'])

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Would delete message'))
        expect(consoleSpy).toHaveBeenCalledWith('  Message: 200')
        expect(consoleSpy).toHaveBeenCalledWith('  Conversation: CV42')
        expect(client.conversationMessages.deleteMessage).not.toHaveBeenCalled()
    })

    it('rejects non-creator with NOT_CREATOR in dry-run', async () => {
        const client = createClient({ messageCreator: 99, sessionUserId: 1 })
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'msg', 'delete', '200', '--dry-run']),
        ).rejects.toHaveProperty('code', 'NOT_CREATOR')
        expect(client.conversationMessages.deleteMessage).not.toHaveBeenCalled()
    })

    it('outputs JSON with --json --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()
        const consoleSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'msg', 'delete', '200', '--json', '--yes'])

        const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0])
        expect(jsonOutput).toEqual({ id: '200', deleted: true })
    })

    it('errors when --json is used without --yes', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)
        const program = createProgram()

        await expect(
            program.parseAsync(['node', 'tdc', 'msg', 'delete', '200', '--json']),
        ).rejects.toHaveProperty('code', 'MISSING_YES_FLAG')

        expect(client.conversationMessages.deleteMessage).not.toHaveBeenCalled()
    })
})

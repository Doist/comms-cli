import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
    getCommsClient: apiMocks.getCommsClient,
}))

import { registerReactCommand } from './react.js'

const createProgram = () => createTestProgram(registerReactCommand)

describe('react refs', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMocks.addReaction.mockResolvedValue(undefined)
        apiMocks.removeReaction.mockResolvedValue(undefined)
        apiMocks.getCommsClient.mockResolvedValue({
            reactions: {
                add: apiMocks.addReaction,
                remove: apiMocks.removeReaction,
            },
        })
    })

    it('accepts thread URLs for react', async () => {
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'react',
            'thread',
            'https://comms.todoist.com/a/1/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
            '+1',
        ])

        expect(apiMocks.addReaction).toHaveBeenCalledWith({
            threadId: 'CeRAj1WU3YFhsVZGDyPr9',
            reaction: '👍',
        })
    })

    it('accepts message URLs for unreact', async () => {
        const program = createProgram()
        captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'unreact',
            'message',
            'https://comms.todoist.com/a/1/msg/CeRAj1WU3YFhsatbAs43L/m/CeRAj1WU3YFhsbp9GT1ir',
            'heart',
        ])

        expect(apiMocks.removeReaction).toHaveBeenCalledWith({
            messageId: 'CeRAj1WU3YFhsbp9GT1ir',
            reaction: '❤️',
        })
    })

    it('outputs JSON for react --json', async () => {
        const program = createProgram()
        const logSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'react', 'thread', '99', '+1', '--json'])

        expect(apiMocks.addReaction).toHaveBeenCalledWith({ threadId: '99', reaction: '👍' })
        const output = JSON.parse(logSpy.mock.calls[0][0])
        expect(output).toEqual({
            targetType: 'thread',
            targetId: '99',
            emoji: '👍',
            action: 'added',
        })
    })

    it('outputs JSON for unreact --json', async () => {
        const program = createProgram()
        const logSpy = captureConsole('log')

        await program.parseAsync(['node', 'tdc', 'unreact', 'comment', '42', 'heart', '--json'])

        expect(apiMocks.removeReaction).toHaveBeenCalledWith({ commentId: '42', reaction: '❤️' })
        const output = JSON.parse(logSpy.mock.calls[0][0])
        expect(output).toEqual({
            targetType: 'comment',
            targetId: '42',
            emoji: '❤️',
            action: 'removed',
        })
    })

    it('outputs JSON for react --json --dry-run without calling API', async () => {
        const program = createProgram()
        const logSpy = captureConsole('log')

        await program.parseAsync([
            'node',
            'tdc',
            'react',
            'message',
            '77',
            'tada',
            '--json',
            '--dry-run',
        ])

        expect(apiMocks.addReaction).not.toHaveBeenCalled()
        const output = JSON.parse(logSpy.mock.calls[0][0])
        expect(output).toEqual({
            targetType: 'message',
            targetId: '77',
            emoji: '🎉',
            action: 'added',
            dryRun: true,
        })
    })
})

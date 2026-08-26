import { createTestProgram } from '@doist/cli-core/testing'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./thread/index.js', () => ({
    registerThreadCommand: (program: Command) => {
        const thread = program.command('thread')
        thread.command('view [ref]').action(() => {
            throw new Error('ROUTED_TO_THREAD')
        })
    },
}))

vi.mock('./conversation/index.js', () => ({
    registerConversationCommand: (program: Command) => {
        const convo = program.command('conversation')
        convo.command('view [ref]').action(() => {
            throw new Error('ROUTED_TO_CONVERSATION')
        })
    },
}))

vi.mock('./msg/index.js', () => ({
    registerMsgCommand: (program: Command) => {
        const msg = program.command('msg')
        msg.command('view [ref]').action(() => {
            throw new Error('ROUTED_TO_MSG')
        })
    },
}))

import { registerViewCommand } from './view.js'

const createProgram = () => createTestProgram(registerViewCommand)

describe('tdc view <url> routing', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('routes thread URL to thread view', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'view',
                'https://comms.todoist.com/a/1585/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9',
            ]),
        ).rejects.toThrow('ROUTED_TO_THREAD')
    })

    it('routes comment URL (thread+comment) to thread view', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'view',
                'https://comms.todoist.com/a/1585/ch/CeRAj1WU3YFhsTejuePLW/t/CeRAj1WU3YFhsVZGDyPr9/c/CeRAj1WU3YFhsY6fUxMhj',
            ]),
        ).rejects.toThrow('ROUTED_TO_THREAD')
    })

    it('routes conversation URL to conversation view', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'view',
                'https://comms.todoist.com/a/1585/msg/CeRAj1WU3YFhsatbAs43L',
            ]),
        ).rejects.toThrow('ROUTED_TO_CONVERSATION')
    })

    it('routes short conversation URL to conversation view', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'view',
                'https://comms.todoist.com/1585/msg/CeRAj1WU3YFhsatbAs43L',
            ]),
        ).rejects.toThrow('ROUTED_TO_CONVERSATION')
    })

    it('routes message URL to msg view', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'view',
                'https://comms.todoist.com/a/1585/msg/CeRAj1WU3YFhsatbAs43L/m/CeRAj1WU3YFhsbp9GT1ir',
            ]),
        ).rejects.toThrow('ROUTED_TO_MSG')
    })

    it('throws for unrecognized Comms URL', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync(['node', 'tdc', 'view', 'https://comms.todoist.com/a/1585']),
        ).rejects.toThrow('Not a recognized Comms URL')
    })

    it('throws for malformed inbox thread URL with message-like suffix', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync([
                'node',
                'tdc',
                'view',
                'https://comms.todoist.com/20/inbox/t/CeRAj1WU3YFhsVZGDyPr9/msg/CeRAj1WU3YFhsatbAs43L',
            ]),
        ).rejects.toThrow('Not a recognized Comms URL')
    })

    it('throws for non-Comms URL', async () => {
        const program = createProgram()
        await expect(
            program.parseAsync(['node', 'tdc', 'view', 'https://google.com/something']),
        ).rejects.toThrow('Not a recognized Comms URL')
    })
})

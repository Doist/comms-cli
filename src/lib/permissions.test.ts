import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth.js', () => ({
    getAuthMetadata: vi.fn(),
}))

import { getAuthMetadata } from './auth.js'
import {
    ensureMutationAllowed,
    ensureScopeAllowed,
    ensureWriteAllowed,
    isMutatingMethod,
    READ_ONLY_ERROR_MESSAGE,
} from './permissions.js'

const mockGetAuthMetadata = vi.mocked(getAuthMetadata)

describe('permissions', () => {
    it('blocks writes in read-only mode', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-only',
            authScope: 'user:read workspaces:read',
            source: 'config',
        })

        await expect(ensureWriteAllowed()).rejects.toThrow(READ_ONLY_ERROR_MESSAGE)
    })

    it('allows writes in read-write mode', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            source: 'config',
        })

        await expect(ensureWriteAllowed()).resolves.toBeUndefined()
    })

    it('allows writes when mode is unknown', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'unknown',
            source: 'env',
        })

        await expect(ensureWriteAllowed()).resolves.toBeUndefined()
    })

    it('identifies mutating methods', () => {
        // Write operations should be mutating
        expect(isMutatingMethod('comments.createComment')).toBe(true)
        expect(isMutatingMethod('comments.updateComment')).toBe(true)
        expect(isMutatingMethod('comments.deleteComment')).toBe(true)
        expect(isMutatingMethod('conversations.createConversation')).toBe(true)
        expect(isMutatingMethod('conversations.archiveConversation')).toBe(true)
        expect(isMutatingMethod('conversationMessages.createMessage')).toBe(true)
        expect(isMutatingMethod('conversationMessages.updateMessage')).toBe(true)
        expect(isMutatingMethod('conversationMessages.deleteMessage')).toBe(true)
        expect(isMutatingMethod('inbox.archiveThread')).toBe(true)
        expect(isMutatingMethod('reactions.add')).toBe(true)
        expect(isMutatingMethod('reactions.remove')).toBe(true)
    })

    it('identifies safe (read-only) methods', () => {
        expect(isMutatingMethod('users.getSessionUser')).toBe(false)
        expect(isMutatingMethod('workspaces.getWorkspaces')).toBe(false)
        expect(isMutatingMethod('workspaces.getPublicChannels')).toBe(false)
        expect(isMutatingMethod('threads.getThread')).toBe(false)
        expect(isMutatingMethod('threads.getUnread')).toBe(false)
        expect(isMutatingMethod('comments.getComment')).toBe(false)
        expect(isMutatingMethod('comments.getComments')).toBe(false)
        expect(isMutatingMethod('channels.getChannel')).toBe(false)
        expect(isMutatingMethod('channels.getChannels')).toBe(false)
        expect(isMutatingMethod('conversations.getConversations')).toBe(false)
        expect(isMutatingMethod('conversations.getConversation')).toBe(false)
        expect(isMutatingMethod('conversations.getUnread')).toBe(false)
        expect(isMutatingMethod('conversationMessages.getMessage')).toBe(false)
        expect(isMutatingMethod('conversationMessages.getMessages')).toBe(false)
        expect(isMutatingMethod('inbox.getInbox')).toBe(false)
    })

    it('treats unknown API methods as mutating (safe-by-default)', () => {
        expect(isMutatingMethod('someNewApi.newMethod')).toBe(true)
    })
})

describe('ensureScopeAllowed', () => {
    it('blocks group writes when the grant lacks workspaces:write', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            authScope: 'user:read workspaces:read comms:content:write',
            source: 'config',
        })

        await expect(ensureScopeAllowed('groups.addUsers')).rejects.toThrow('workspaces:write')
    })

    it('allows group writes when workspaces:write is granted', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            authScope: 'user:read workspaces:read workspaces:write',
            source: 'config',
        })

        await expect(ensureScopeAllowed('groups.addUsers')).resolves.toBeUndefined()
    })

    it('matches whole scopes, not substrings', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            // A naive `includes` on the raw string would pass on this.
            authScope: 'workspaces:write:something-else',
            source: 'config',
        })

        await expect(ensureScopeAllowed('groups.addUsers')).rejects.toThrow('workspaces:write')
    })

    it('accepts comma-delimited scope strings', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            authScope: 'workspaces:write,comms:content:write',
            source: 'config',
        })

        await expect(ensureScopeAllowed('groups.addUsers')).resolves.toBeUndefined()
    })

    it('skips the auth-metadata lookup for methods needing no extra scope', async () => {
        mockGetAuthMetadata.mockClear()

        await expect(ensureScopeAllowed('comments.createComment')).resolves.toBeUndefined()
        expect(mockGetAuthMetadata).not.toHaveBeenCalled()
    })

    it('fails open when the granted scope is unknown (env token)', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'unknown',
            source: 'env',
        })

        await expect(ensureScopeAllowed('groups.addUsers')).resolves.toBeUndefined()
    })

    it('ignores methods with no declared scope requirement', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            authScope: 'comms:content:write',
            source: 'config',
        })

        await expect(ensureScopeAllowed('comments.createComment')).resolves.toBeUndefined()
    })

    it('covers every group write, not just membership changes', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            authScope: 'comms:content:write',
            source: 'config',
        })

        for (const method of [
            'groups.createGroup',
            'groups.updateGroup',
            'groups.deleteGroup',
            'groups.addUsers',
            'groups.removeUsers',
        ]) {
            await expect(ensureScopeAllowed(method)).rejects.toThrow('workspaces:write')
        }
    })
})

describe('ensureMutationAllowed', () => {
    it('reads auth metadata once for both checks', async () => {
        mockGetAuthMetadata.mockClear()
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            authScope: 'workspaces:write',
            source: 'config',
        })

        await expect(ensureMutationAllowed('groups.addUsers')).resolves.toBeUndefined()
        // getAuthMetadata hits the config file uncached, so one read, not two.
        expect(mockGetAuthMetadata).toHaveBeenCalledTimes(1)
    })

    it('rejects read-only mode before checking scopes', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-only',
            authScope: 'workspaces:read',
            source: 'config',
        })

        await expect(ensureMutationAllowed('groups.addUsers')).rejects.toThrow(
            READ_ONLY_ERROR_MESSAGE,
        )
    })

    it('rejects an under-scoped grant', async () => {
        mockGetAuthMetadata.mockResolvedValue({
            authMode: 'read-write',
            authScope: 'comms:content:write',
            source: 'config',
        })

        await expect(ensureMutationAllowed('groups.addUsers')).rejects.toThrow('workspaces:write')
    })
})

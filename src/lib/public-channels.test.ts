import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({
    getCommsClient: vi.fn(),
}))

import { getCommsClient } from './api.js'
import { includePrivateChannels, resetGlobalArgs } from './global-args.js'
import {
    assertChannelIsPublic,
    clearPublicChannelCache,
    getPublicChannelIds,
} from './public-channels.js'

const mockGetCommsClient = vi.mocked(getCommsClient)

function makeMockChannels(
    channels: Array<{ id: string; public: boolean }>,
): ReturnType<typeof getCommsClient> {
    return Promise.resolve({
        channels: {
            getChannels: vi.fn().mockResolvedValue(channels),
        },
    }) as unknown as ReturnType<typeof getCommsClient>
}

describe('includePrivateChannels', () => {
    const originalArgv = [...process.argv]
    const originalEnv = process.env.COMMS_INCLUDE_PRIVATE_CHANNELS

    beforeEach(() => {
        resetGlobalArgs()
        process.argv = ['node', 'tdc']
        delete process.env.COMMS_INCLUDE_PRIVATE_CHANNELS
    })

    afterEach(() => {
        process.argv = originalArgv
        if (originalEnv !== undefined) {
            process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = originalEnv
        } else {
            delete process.env.COMMS_INCLUDE_PRIVATE_CHANNELS
        }
        resetGlobalArgs()
    })

    it('returns false by default (private channels hidden)', () => {
        expect(includePrivateChannels()).toBe(false)
    })

    it('returns true when --include-private-channels is in argv', () => {
        process.argv = ['node', 'tdc', 'channels', '--include-private-channels']
        resetGlobalArgs()
        expect(includePrivateChannels()).toBe(true)
    })

    it('returns true when COMMS_INCLUDE_PRIVATE_CHANNELS=1', () => {
        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = '1'
        expect(includePrivateChannels()).toBe(true)
    })

    it('returns true when COMMS_INCLUDE_PRIVATE_CHANNELS=true', () => {
        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = 'true'
        expect(includePrivateChannels()).toBe(true)
    })

    it('returns false for other env values', () => {
        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = '0'
        expect(includePrivateChannels()).toBe(false)

        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = 'false'
        expect(includePrivateChannels()).toBe(false)

        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = ''
        expect(includePrivateChannels()).toBe(false)
    })
})

describe('getPublicChannelIds', () => {
    beforeEach(() => {
        clearPublicChannelCache()
    })

    it('returns only public channel IDs', async () => {
        mockGetCommsClient.mockImplementation(() =>
            makeMockChannels([
                { id: 'CH1', public: true },
                { id: 'CH2', public: false },
                { id: 'CH3', public: true },
            ]),
        )

        const ids = await getPublicChannelIds(100)
        expect(ids).toEqual(new Set(['CH1', 'CH3']))
    })

    it('caches results per workspace', async () => {
        const getChannels = vi.fn().mockResolvedValue([{ id: 'CH1', public: true }])
        mockGetCommsClient.mockResolvedValue({
            channels: { getChannels },
        } as unknown as Awaited<ReturnType<typeof getCommsClient>>)

        await getPublicChannelIds(100)
        await getPublicChannelIds(100)

        expect(getChannels).toHaveBeenCalledTimes(1)
    })

    it('fetches separately for different workspaces', async () => {
        const getChannels = vi.fn().mockResolvedValue([{ id: 'CH1', public: true }])
        mockGetCommsClient.mockResolvedValue({
            channels: { getChannels },
        } as unknown as Awaited<ReturnType<typeof getCommsClient>>)

        await getPublicChannelIds(100)
        await getPublicChannelIds(200)

        expect(getChannels).toHaveBeenCalledTimes(2)
    })
})

describe('assertChannelIsPublic', () => {
    const originalArgv = [...process.argv]
    const originalEnv = process.env.COMMS_INCLUDE_PRIVATE_CHANNELS

    beforeEach(() => {
        clearPublicChannelCache()
        resetGlobalArgs()
        process.argv = ['node', 'tdc']
        delete process.env.COMMS_INCLUDE_PRIVATE_CHANNELS
    })

    afterEach(() => {
        process.argv = originalArgv
        if (originalEnv !== undefined) {
            process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = originalEnv
        } else {
            delete process.env.COMMS_INCLUDE_PRIVATE_CHANNELS
        }
        resetGlobalArgs()
    })

    it('throws for private channels by default', async () => {
        mockGetCommsClient.mockImplementation(() =>
            makeMockChannels([
                { id: 'CH5', public: true },
                { id: 'CH6', public: false },
            ]),
        )

        await expect(assertChannelIsPublic('CH6', 100)).rejects.toThrow('private channel')
    })

    it('allows public channels by default', async () => {
        mockGetCommsClient.mockImplementation(() => makeMockChannels([{ id: 'CH5', public: true }]))

        await expect(assertChannelIsPublic('CH5', 100)).resolves.toBeUndefined()
    })

    it('allows private channels when --include-private-channels is set', async () => {
        process.argv = ['node', 'tdc', '--include-private-channels']
        resetGlobalArgs()
        await expect(assertChannelIsPublic('CH999', 100)).resolves.toBeUndefined()
    })

    it('allows private channels when env var is set', async () => {
        process.env.COMMS_INCLUDE_PRIVATE_CHANNELS = '1'
        await expect(assertChannelIsPublic('CH999', 100)).resolves.toBeUndefined()
    })
})

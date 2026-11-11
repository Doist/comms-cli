import { DEFAULT_API_VERSION } from '@todoist/comms-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }

vi.hoisted(() => {
    vi.stubEnv('AI_AGENT', 'codex')
})

const authMocks = vi.hoisted(() => ({
    getApiTokenSnapshot: vi.fn(),
}))

vi.mock('./auth.js', () => ({
    getApiTokenSnapshot: authMocks.getApiTokenSnapshot,
}))

import { extendedSearch } from './search-api.js'
import { usageTracking } from './usage-tracking.js'

const fetchMock = vi.fn()

function searchResponse(): Response {
    return new Response(JSON.stringify({ items: [], has_more: false, is_plan_restricted: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}

describe('extendedSearch', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock)
        fetchMock.mockReset().mockResolvedValue(searchResponse())
        authMocks.getApiTokenSnapshot.mockReset().mockResolvedValue({
            token: 'oauth-token',
            account: {
                id: '42',
                label: 'Ada',
                authMode: 'read-write',
                authScope: '',
                authResource: 'https://comms.staging.todoist.com',
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    it('uses the stored OAuth resource for non-production search requests', async () => {
        await extendedSearch({ workspaceId: 69, query: 'roadmap' })

        expect(fetchMock.mock.calls[0][0]).toBe(
            `https://comms.staging.todoist.com/api/${DEFAULT_API_VERSION}/search?workspace_id=69&query=roadmap`,
        )
    })

    it('sends the conversations type', async () => {
        await extendedSearch({ workspaceId: 69, query: 'Outcasts', type: 'conversations' })

        const requestUrl = new URL(fetchMock.mock.calls[0][0])
        expect(requestUrl.searchParams.get('type')).toBe('conversations')
    })

    it('sends the CLI usage headers alongside its own', async () => {
        usageTracking.setCommand('search')

        await extendedSearch({ workspaceId: 69, query: 'roadmap' })

        expect(fetchMock.mock.calls[0][1].headers).toEqual({
            authorization: 'Bearer oauth-token',
            'content-type': 'application/json',
            'user-agent': `comms-cli/${packageJson.version}`,
            'doist-platform': 'cli',
            'doist-version': packageJson.version,
            'doist-os': expect.stringMatching(/^(macos|linux|windows|unknown)$/),
            'request-id': expect.any(String),
            'session-id': expect.any(String),
            'cli-command': 'search',
            'cli-agent': 'codex',
        })
    })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
    getApiTokenSnapshot: vi.fn(),
}))

vi.mock('./auth.js', () => ({
    getApiTokenSnapshot: authMocks.getApiTokenSnapshot,
}))

import { extendedSearch } from './search-api.js'

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
            'https://comms.staging.todoist.com/api/v1/search?workspace_id=69&query=roadmap',
        )
    })

    it('lets COMMS_BASE_URL override the stored OAuth resource', async () => {
        vi.stubEnv('COMMS_BASE_URL', 'https://comms.local.todoist.com')

        await extendedSearch({ workspaceId: 69, query: 'roadmap' })

        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://comms.local.todoist.com/api/v1/search?workspace_id=69&query=roadmap',
        )
    })
})

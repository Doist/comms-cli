import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LOGO_URI, OAUTH_CLIENT_ID } from './auth-constants.js'
import { FULL_ACCESS_SCOPES } from './auth-provider.js'

// Todoist serves this document's URL as the CLI's client_id, so these checks
// mirror what its validator rejects, plus the values the CLI relies on.
const DOCUMENT_PATH = fileURLToPath(new URL('../../oauth/client-metadata.json', import.meta.url))
const raw = readFileSync(DOCUMENT_PATH, 'utf8')
const document = JSON.parse(raw) as Record<string, unknown>

/** These metadata arrays are sets, so compare them without regard to order. */
function sorted(value: unknown): unknown {
    return Array.isArray(value) ? [...value].sort() : value
}

describe('OAuth client ID metadata document', () => {
    it('is served from the URL the CLI sends as its client_id', () => {
        expect(OAUTH_CLIENT_ID).toBe(
            'https://raw.githubusercontent.com/Doist/comms-cli/main/oauth/client-metadata.json',
        )
        expect(document.client_id).toBe(OAUTH_CLIENT_ID)
    })

    it('fits within the size Todoist will fetch', () => {
        expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(5 * 1024)
    })

    it('registers portless loopback callbacks for the host cli-core binds', () => {
        expect(sorted(document.redirect_uris)).toEqual([
            'http://127.0.0.1/callback',
            'http://localhost/callback',
        ])
    })

    it('is a public client that can refresh', () => {
        expect(document.token_endpoint_auth_method).toBe('none')
        expect(sorted(document.grant_types)).toEqual(['authorization_code', 'refresh_token'])
        expect(sorted(document.response_types)).toEqual(['code'])
    })

    it('allows every scope a login can request', () => {
        expect(document.scope).toBe(FULL_ACCESS_SCOPES.join(' '))
    })

    it('presents the CLI the same way as the sign-in pages', () => {
        expect(document.client_name).toBe('Comms CLI')
        expect(document.client_uri).toBe('https://github.com/doist/comms-cli')
        expect(document.logo_uri).toBe(LOGO_URI)
    })
})

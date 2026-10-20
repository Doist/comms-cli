import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LOGO_URI } from './auth-constants.js'
import { renderError, renderSuccess } from './auth-pages.js'

describe('auth pages', () => {
    it.each([
        ['success', renderSuccess()],
        ['error', renderError('boom')],
    ])('the %s page shows the published icon rather than an inline copy', (_, html) => {
        expect(html).toContain(`<img src="${LOGO_URI}"`)
        expect(html).toContain('referrerpolicy="no-referrer"')
        expect(html).not.toMatch(/<svg[^>]*viewBox="0 0 72 72"/)
    })
})

describe('LOGO_URI', () => {
    it('points at a file in this repo, which registered OAuth clients keep using', () => {
        const path = new URL(LOGO_URI).pathname.replace(/^\/doist\/comms-cli\/main\//, '')
        expect(existsSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)))).toBe(true)
    })
})

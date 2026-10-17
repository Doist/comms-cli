import { describe, expect, it } from 'vitest'

import { LOGO_URI } from './auth-constants.js'
import { renderError, renderSuccess } from './auth-pages.js'

describe('auth pages', () => {
    it.each([
        ['success', renderSuccess()],
        ['error', renderError('boom')],
    ])('the %s page shows the published icon rather than an inline copy', (_, html) => {
        expect(html).toContain(`<img src="${LOGO_URI}"`)
        expect(html).not.toContain('Size=72, Style=Color')
    })
})

import { describe, expect, it } from 'vitest'
import { parseDuration } from './duration.js'

describe('parseDuration', () => {
    it.each([
        ['30m', 30 * 60_000],
        ['2h', 2 * 3_600_000],
        ['1d', 86_400_000],
        ['1h30m', 90 * 60_000],
        ['1d2h3m', 86_400_000 + 2 * 3_600_000 + 3 * 60_000],
        [' 2H ', 2 * 3_600_000],
    ])('parses %s', (input, expected) => {
        expect(parseDuration(input)).toBe(expected)
    })

    it.each(['', 'soon', '2', '2x', '-1h', '1.5h', '0m', '0h0m', '30m1h'])(
        'rejects %j',
        (input) => {
            expect(parseDuration(input)).toBeNull()
        },
    )
})

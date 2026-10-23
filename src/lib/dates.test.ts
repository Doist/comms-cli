import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeDate, parseDate, parseLocalDate } from './dates.js'

describe('formatRelativeDate', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns "just now" for times less than a minute ago', () => {
        const date = new Date('2024-06-15T11:59:30Z')
        expect(formatRelativeDate(date)).toBe('just now')
    })

    it('returns minutes ago for times less than an hour ago', () => {
        expect(formatRelativeDate(new Date('2024-06-15T11:55:00Z'))).toBe('5 minutes ago')
        expect(formatRelativeDate(new Date('2024-06-15T11:59:00Z'))).toBe('1 minute ago')
        expect(formatRelativeDate(new Date('2024-06-15T11:30:00Z'))).toBe('30 minutes ago')
    })

    it('returns hours ago for times less than a day ago', () => {
        expect(formatRelativeDate(new Date('2024-06-15T10:00:00Z'))).toBe('2 hours ago')
        expect(formatRelativeDate(new Date('2024-06-15T11:00:00Z'))).toBe('1 hour ago')
    })

    it('returns "yesterday" for times 1-2 days ago', () => {
        expect(formatRelativeDate(new Date('2024-06-14T12:00:00Z'))).toBe('yesterday')
    })

    it('returns days ago for times less than a week ago', () => {
        expect(formatRelativeDate(new Date('2024-06-12T12:00:00Z'))).toBe('3 days ago')
        expect(formatRelativeDate(new Date('2024-06-10T12:00:00Z'))).toBe('5 days ago')
    })

    it('returns absolute date for older times', () => {
        const result = formatRelativeDate(new Date('2024-05-01T12:00:00Z'))
        expect(result).toMatch(/May 1/)
    })

    it('includes year for dates from previous years', () => {
        const result = formatRelativeDate(new Date('2023-01-15T12:00:00Z'))
        expect(result).toMatch(/Jan 15, 2023/)
    })

    it('handles string dates', () => {
        expect(formatRelativeDate('2024-06-15T11:59:00Z')).toBe('1 minute ago')
    })
})

describe('parseDate', () => {
    it('parses valid ISO dates', () => {
        const result = parseDate('2024-06-15T12:00:00Z')
        expect(result).toBeInstanceOf(Date)
        expect(result?.toISOString()).toBe('2024-06-15T12:00:00.000Z')
    })

    it('parses date-only strings', () => {
        const result = parseDate('2024-06-15')
        expect(result).toBeInstanceOf(Date)
    })

    it('returns null for invalid dates', () => {
        expect(parseDate('invalid')).toBeNull()
        expect(parseDate('')).toBeNull()
    })
})

describe('parseLocalDate', () => {
    it.each([
        ['2026-10-20', new Date(2026, 9, 20)],
        ['2026-10-20T09:30', new Date(2026, 9, 20, 9, 30)],
        ['2026-10-20 09:30', new Date(2026, 9, 20, 9, 30)],
        ['2026-10-20T09:30:15', new Date(2026, 9, 20, 9, 30, 15)],
        ['2026-10-20T09:30Z', new Date(Date.UTC(2026, 9, 20, 9, 30))],
        ['2026-10-20T09:30+02:00', new Date(Date.UTC(2026, 9, 20, 7, 30))],
        ['2026-10-20T09:30-0530', new Date(Date.UTC(2026, 9, 20, 15, 0))],
        ['2026-10-20T09:30+14:00', new Date(Date.UTC(2026, 9, 19, 19, 30))],
        ['2026-10-20T09:30-12:00', new Date(Date.UTC(2026, 9, 20, 21, 30))],
        ['2026-10-20T09:30+00:00', new Date(Date.UTC(2026, 9, 20, 9, 30))],
        ['2026-10-20T09:00:00.000Z', new Date(Date.UTC(2026, 9, 20, 9, 0, 0, 0))],
        ['2026-10-20T09:00:00.5Z', new Date(Date.UTC(2026, 9, 20, 9, 0, 0, 500))],
        ['2026-10-20T09:00:00.123456Z', new Date(Date.UTC(2026, 9, 20, 9, 0, 0, 123))],
        ['2026-10-20T09:00:00.250+02:00', new Date(Date.UTC(2026, 9, 20, 7, 0, 0, 250))],
        ['2026-10-20T09:00:00.250', new Date(2026, 9, 20, 9, 0, 0, 250)],
        [' 2026-10-20 ', new Date(2026, 9, 20)],
    ])('parses %s', (input, expected) => {
        expect(parseLocalDate(input)?.getTime()).toBe(expected.getTime())
    })

    it.each([
        '',
        'next week',
        '2026',
        '2026-10',
        '20261020',
        '2026-02-30',
        '2026-02-31T10:00',
        '2026-02-30T10:00Z',
        '2026-04-31',
        '2026-13-01',
        '2026-00-10',
        '2026-10-00',
        '2026-10-32',
        '2026-10-20T24:00',
        '2026-10-20T09:60',
        '2026-10-20T09:30:60',
        '2026-10-20T09:30+25:00',
        '2026-10-20Z',
        '2026-10-20T09:30.5',
        '2026-10-20T09:00:00.',
        '2026-10-20T09:00:00.1234567890Z',
        '0099-01-01',
        '0001-01-01',
        '0000-01-01',
        '0099-01-01T00:00Z',
        '2026-10-20T09:30+14:01',
        '2026-10-20T09:30+15:00',
        '2026-10-20T09:30+23:59',
        '2026-10-20T09:30-12:01',
    ])('rejects %j', (input) => {
        expect(parseLocalDate(input)).toBeNull()
    })

    it('accepts 29 February only in a leap year', () => {
        expect(parseLocalDate('2028-02-29')).not.toBeNull()
        expect(parseLocalDate('2026-02-29')).toBeNull()
    })
})

describe('parseLocalDate round trip', () => {
    it('accepts what Date.toISOString() produces, millisecond for millisecond', () => {
        for (const ms of [0, 1, 999, 1_700_000_000_123, Date.now() + 86_400_000]) {
            const iso = new Date(ms).toISOString()
            expect(parseLocalDate(iso)?.getTime()).toBe(ms)
        }
    })
})

describe('parseLocalDate around daylight saving', () => {
    const originalTz = process.env.TZ

    beforeAll(() => {
        process.env.TZ = 'America/New_York'
    })

    afterAll(() => {
        if (originalTz === undefined) {
            delete process.env.TZ
        } else {
            process.env.TZ = originalTz
        }
    })

    it('rejects a local time that does not exist in the spring-forward gap', () => {
        expect(parseLocalDate('2026-03-08T02:30')).toBeNull()
        expect(parseLocalDate('2026-03-08T02:00:00')).toBeNull()
    })

    it('accepts the times on either side of the gap', () => {
        expect(parseLocalDate('2026-03-08T01:59')).not.toBeNull()
        expect(parseLocalDate('2026-03-08T03:00')).not.toBeNull()
    })

    it('accepts a time that happens twice when the clocks go back', () => {
        expect(parseLocalDate('2026-11-01T01:30')).not.toBeNull()
    })

    it('does not apply the gap rule to an explicit offset', () => {
        expect(parseLocalDate('2026-03-08T02:30Z')).not.toBeNull()
    })
})

describe('parseLocalDate never refuses a real calendar day, in any time zone', () => {
    const originalTz = process.env.TZ
    // Zones whose clocks skip at midnight (so midnight does not exist that day), plus half-hour gaps.
    const zones = [
        'UTC',
        'America/New_York',
        'America/Santiago',
        'America/Havana',
        'Asia/Beirut',
        'Africa/Cairo',
        'Australia/Lord_Howe',
        'Asia/Kolkata',
    ]

    afterAll(() => {
        if (originalTz === undefined) {
            delete process.env.TZ
        } else {
            process.env.TZ = originalTz
        }
    })

    it.each(zones)('accepts every day of 2026 as a date-only value in %s', (zone) => {
        process.env.TZ = zone
        const refused: string[] = []
        for (let day = 0; day < 365; day++) {
            const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10)
            if (parseLocalDate(date) === null) {
                refused.push(date)
            }
        }
        expect(refused).toEqual([])
    })

    it('resolves a date-only value whose midnight is skipped to the first instant of that day', () => {
        process.env.TZ = 'America/Santiago'
        const result = parseLocalDate('2026-09-06')
        expect(result?.toISOString()).toBe('2026-09-06T04:00:00.000Z')
    })

    it('still rejects a typed time inside the gap on that day', () => {
        process.env.TZ = 'America/Santiago'
        expect(parseLocalDate('2026-09-06T00:30')).toBeNull()
        expect(parseLocalDate('2026-09-06T01:00')).not.toBeNull()
    })

    it('resolves a repeated autumn hour to its first occurrence', () => {
        process.env.TZ = 'America/New_York'
        expect(parseLocalDate('2026-11-01T01:30')?.toISOString()).toBe('2026-11-01T05:30:00.000Z')
    })
})

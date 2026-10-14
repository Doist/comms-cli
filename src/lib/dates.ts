export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function formatRelativeDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date
    const now = new Date()
    const diff = now.getTime() - d.getTime()

    if (diff < 0) {
        return formatAbsoluteDate(d)
    }

    if (diff < MINUTE) {
        return 'just now'
    }

    if (diff < HOUR) {
        const mins = Math.floor(diff / MINUTE)
        return `${mins} minute${mins === 1 ? '' : 's'} ago`
    }

    if (diff < DAY) {
        const hours = Math.floor(diff / HOUR)
        return `${hours} hour${hours === 1 ? '' : 's'} ago`
    }

    if (diff < 2 * DAY) {
        return 'yesterday'
    }

    if (diff < 7 * DAY) {
        const days = Math.floor(diff / DAY)
        return `${days} days ago`
    }

    return formatAbsoluteDate(d)
}

function formatAbsoluteDate(date: Date): string {
    const now = new Date()
    const sameYear = date.getFullYear() === now.getFullYear()

    if (sameYear) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function parseDate(dateStr: string): Date | null {
    const d = new Date(dateStr)
    return Number.isNaN(d.getTime()) ? null : d
}

const ISO_LOCAL =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i

/**
 * Parses `YYYY-MM-DD` or `YYYY-MM-DD[T ]HH:MM[:SS[.fraction]]` with an optional `Z` or `+HH:MM`
 * offset, which includes everything `Date.toISOString()` produces.
 * Without an offset the value is local time, date-only included (unlike `new Date('2026-10-20')`,
 * which is UTC). Returns `null` for anything else, including calendar dates that `Date` would
 * silently roll over such as `2026-02-30`.
 */
export function parseLocalDate(value: string): Date | null {
    const match = ISO_LOCAL.exec(value.trim())
    if (!match) {
        return null
    }
    const [, year, month, day, hour, minute, second, fraction, zone] = match
    if (hour === undefined && zone !== undefined) {
        return null
    }

    const [y, mo, d, h, mi, s] = [year, month, day, hour ?? '0', minute ?? '0', second ?? '0'].map(
        Number,
    )
    const ms = Number((fraction ?? '').padEnd(3, '0').slice(0, 3))
    if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) {
        return null
    }

    if (zone === undefined) {
        const local = new Date(y, mo - 1, d, h, mi, s, ms)
        // A time inside a daylight-saving gap does not exist; `Date` shifts it to the next hour.
        const exists =
            local.getMonth() === mo - 1 &&
            local.getDate() === d &&
            local.getHours() === h &&
            local.getMinutes() === mi &&
            local.getSeconds() === s
        return exists ? local : null
    }

    const utc = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms))
    if (utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) {
        return null
    }
    if (zone.toUpperCase() === 'Z') {
        return utc
    }
    const digits = zone.slice(1).replace(':', '')
    const offsetHours = Number(digits.slice(0, 2))
    const offsetMinutes = Number(digits.slice(2))
    if (offsetHours > 23 || offsetMinutes > 59) {
        return null
    }
    const sign = zone.startsWith('-') ? -1 : 1
    return new Date(utc.getTime() - sign * (offsetHours * 60 + offsetMinutes) * MINUTE)
}

export function formatDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

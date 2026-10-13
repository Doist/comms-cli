const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000 } as const

/**
 * Parses a compact duration such as `30m`, `2h`, `1d` or `1h30m` into milliseconds.
 * Returns `null` for anything else, including a zero duration.
 */
export function parseDuration(value: string): number | null {
    const match = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(value.trim().toLowerCase())
    if (!match || match.slice(1).every((part) => part === undefined)) {
        return null
    }
    const [, days, hours, minutes] = match
    const total =
        Number(days ?? 0) * UNIT_MS.d +
        Number(hours ?? 0) * UNIT_MS.h +
        Number(minutes ?? 0) * UNIT_MS.m
    return total > 0 ? total : null
}

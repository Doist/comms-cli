import type { SetStatusArgs } from '@doist/comms-sdk'
import { getCommsClient } from '../../lib/api.js'
import { parseDate } from '../../lib/dates.js'
import { parseDuration } from '../../lib/duration.js'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { formatStatus } from './helpers.js'

type SetStatusOptions = MutationOptions & {
    emoji?: string
    until?: string
    for?: string
    pauseNotifications?: boolean
}

// `new Date('2026-10-20')` is UTC midnight, but every other form without an offset is local time.
function parseLocalDate(value: string): Date | null {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (dateOnly) {
        const [, year, month, day] = dateOnly
        return new Date(Number(year), Number(month) - 1, Number(day))
    }
    return parseDate(value)
}

function resolveExpiry(options: SetStatusOptions): Date | undefined {
    if (options.until !== undefined && options.for !== undefined) {
        throw new CliError('CONFLICTING_OPTIONS', 'Cannot use --until and --for together')
    }

    if (options.until !== undefined) {
        const date = parseLocalDate(options.until)
        if (!date) {
            throw new CliError('INVALID_DATE', `Invalid --until date: ${options.until}`, [
                'Use ISO 8601, e.g. 2026-10-14T15:00 (local time) or 2026-10-14T15:00Z',
            ])
        }
        return date
    }

    if (options.for !== undefined) {
        const duration = parseDuration(options.for)
        if (duration === null) {
            throw new CliError('INVALID_VALUE', `Invalid --for duration: ${options.for}`, [
                'Use minutes, hours or days, e.g. 30m, 2h, 1d or 1h30m',
            ])
        }
        return new Date(Date.now() + duration)
    }

    return undefined
}

export async function setStatus(message: string, options: SetStatusOptions): Promise<void> {
    const activeUntil = resolveExpiry(options)

    const args: SetStatusArgs = {
        message,
        ...(options.emoji ? { emoji: options.emoji } : {}),
        ...(activeUntil ? { activeUntil } : {}),
        ...(options.pauseNotifications ? { effects: { pauseNotifications: {} } } : {}),
    }

    if (options.dryRun) {
        printDryRun('set status', {
            Message: message,
            Emoji: options.emoji,
            Until: activeUntil?.toLocaleString(),
            'Pause notifications': options.pauseNotifications ? 'yes' : undefined,
        })
        return
    }

    const client = await getCommsClient()
    const user = await client.users.setStatus(args)

    if (options.json) {
        console.log(
            options.full
                ? formatJson(user, 'user', true)
                : formatJson({ status: user.status ?? null }),
        )
        return
    }

    console.log(`Status set: ${user.status ? formatStatus(user.status) : message}`)
}

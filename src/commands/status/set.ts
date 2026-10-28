import type { SetStatusArgs } from '@doist/comms-sdk'
import { getCommsClient } from '../../lib/api.js'
import { formatDateTime, parseLocalDate } from '../../lib/dates.js'
import { parseDuration } from '../../lib/duration.js'
import { CliError } from '../../lib/errors.js'
import type { MutationOptions } from '../../lib/options.js'
import { printDryRun } from '../../lib/output.js'
import { formatStatus } from '../../lib/status.js'
import { formatStatusJson } from './helpers.js'

const MAX_MESSAGE_LENGTH = 80

type SetStatusOptions = MutationOptions & {
    emoji?: string
    until?: string
    for?: string
    pauseNotifications?: boolean
    pauseActivity?: boolean
}

function resolveMessage(message: string): string {
    const trimmed = message.trim()
    const length = [...trimmed].length
    if (length < 1 || length > MAX_MESSAGE_LENGTH) {
        throw new CliError(
            'INVALID_VALUE',
            `The message must be 1 to ${MAX_MESSAGE_LENGTH} characters`,
        )
    }
    return trimmed
}

function resolveEmoji(emoji: string | undefined): string | undefined {
    if (emoji === undefined) {
        return undefined
    }
    const trimmed = emoji.trim()
    if (trimmed === '') {
        throw new CliError('INVALID_VALUE', '--emoji cannot be empty')
    }
    if (trimmed.startsWith('-')) {
        throw new CliError('INVALID_VALUE', `--emoji needs an emoji, got ${trimmed}`, [
            'A flag after --emoji was read as its value; put the emoji right after --emoji',
        ])
    }
    return trimmed
}

function resolveExpiry(options: SetStatusOptions): Date | undefined {
    if (options.until !== undefined && options.for !== undefined) {
        throw new CliError('CONFLICTING_OPTIONS', 'Cannot use --until and --for together')
    }

    let expiry: Date | undefined
    if (options.until !== undefined) {
        expiry = parseLocalDate(options.until) ?? undefined
        if (!expiry) {
            throw new CliError('INVALID_DATE', `Invalid --until date: ${options.until}`, [
                'Use a real date as YYYY-MM-DD or YYYY-MM-DDTHH:MM (local time), or add Z or an offset such as +02:00',
            ])
        }
    } else if (options.for !== undefined) {
        const duration = parseDuration(options.for)
        expiry = duration === null ? undefined : new Date(Date.now() + duration)
        if (!expiry || Number.isNaN(expiry.getTime())) {
            throw new CliError('INVALID_VALUE', `Invalid --for duration: ${options.for}`, [
                'Use minutes, hours or days, e.g. 30m, 2h, 1d or 1h30m',
            ])
        }
    }

    if (expiry && expiry.getTime() <= Date.now()) {
        const dateOnly =
            options.until !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(options.until.trim())
        throw new CliError('INVALID_DATE', `The status must end in the future: ${options.until}`, [
            dateOnly
                ? 'A date with no time means midnight at its start, so add a time or use a later date'
                : 'Use a date or time in the future',
        ])
    }
    return expiry
}

export async function setStatus(message: string, options: SetStatusOptions): Promise<void> {
    const text = resolveMessage(message)
    const emoji = resolveEmoji(options.emoji)
    const activeUntil = resolveExpiry(options)

    const args: SetStatusArgs = {
        message: text,
        emoji: emoji ?? null,
        activeUntil: activeUntil ?? null,
        effects: {
            pauseNotifications: options.pauseNotifications ? {} : null,
            pauseActivity: options.pauseActivity ? {} : null,
        },
    }

    if (options.dryRun) {
        printDryRun('set status', {
            Message: text,
            Emoji: emoji ?? 'cleared',
            Until: activeUntil ? formatDateTime(activeUntil) : 'cleared',
            'Pause notifications': options.pauseNotifications ? 'yes' : 'cleared',
            'Pause activity': options.pauseActivity ? 'yes' : 'cleared',
        })
        return
    }

    const client = await getCommsClient()
    const user = await client.users.setStatus(args)

    // The server accepted the call but reports nothing active, e.g. an expiry that has already passed.
    if (!user.status) {
        throw new CliError(
            'INVALID_STATE',
            'Nothing changed: Comms accepted the request but there is no active status, usually because the expiry has already passed',
            [
                'Run `tdc status` to see the current status',
                'To keep a status active, set a later --until or --for',
            ],
        )
    }

    console.log(
        options.json
            ? formatStatusJson(user, options.full)
            : `Status set: ${formatStatus(user.status)}`,
    )
}

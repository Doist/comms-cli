import type { User, UserStatus } from '@doist/comms-sdk'
import { formatDateTime } from '../../lib/dates.js'
import { formatJson } from '../../lib/output.js'

export function formatStatus(status: UserStatus): string {
    const parts = [status.emoji ? `${status.emoji} ${status.message}` : status.message]
    if (status.activeUntil) {
        parts.push(`until ${formatDateTime(new Date(status.activeUntil))}`)
    }
    if (status.effects?.pauseNotifications) {
        parts.push('notifications paused')
    }
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0]
}

/** The `{ status }` payload, or the whole user with `--full`, as every status command prints it. */
export function formatStatusJson(user: User, full: boolean | undefined): string {
    return full ? formatJson(user, 'user', true) : formatJson({ status: user.status ?? null })
}

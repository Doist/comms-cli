import type { UserStatus } from '@doist/comms-sdk'
import { formatDateTime } from '../../lib/dates.js'

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

import type { UserStatus } from '@doist/comms-sdk'

export function formatStatus(status: UserStatus): string {
    const parts = [status.emoji ? `${status.emoji} ${status.message}` : status.message]
    if (status.activeUntil) {
        parts.push(`until ${new Date(status.activeUntil).toLocaleString()}`)
    }
    if (status.effects?.pauseNotifications) {
        parts.push('notifications paused')
    }
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0]
}

import type { User } from '@doist/comms-sdk'
import { formatJson } from '../../lib/output.js'

/** The `{ status }` payload, or the whole user with `--full`, as every status command prints it. */
export function formatStatusJson(user: User, full: boolean | undefined): string {
    return full ? formatJson(user, 'user', true) : formatJson({ status: user.status ?? null })
}

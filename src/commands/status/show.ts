import { getSessionUser } from '../../lib/api.js'
import type { ViewOptions } from '../../lib/options.js'
import { formatStatus } from '../../lib/status.js'
import { formatStatusJson } from './helpers.js'

export async function showStatus(options: ViewOptions): Promise<void> {
    const user = await getSessionUser()

    if (options.json) {
        console.log(formatStatusJson(user, options.full))
        return
    }

    console.log(user.status ? formatStatus(user.status) : 'No status set.')
}

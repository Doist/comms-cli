import { getSessionUser } from '../../lib/api.js'
import type { ViewOptions } from '../../lib/options.js'
import { formatJson } from '../../lib/output.js'
import { formatStatus } from './helpers.js'

export async function showStatus(options: ViewOptions): Promise<void> {
    const user = await getSessionUser()

    if (options.json) {
        console.log(
            options.full
                ? formatJson(user, 'user', true)
                : formatJson({ status: user.status ?? null }),
        )
        return
    }

    console.log(user.status ? formatStatus(user.status) : 'No status set.')
}

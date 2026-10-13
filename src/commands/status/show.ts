import { getSessionUser } from '../../lib/api.js'
import type { ViewOptions } from '../../lib/options.js'
import { formatJson } from '../../lib/output.js'
import { formatStatus } from './helpers.js'

export async function showStatus(options: ViewOptions): Promise<void> {
    const { status } = await getSessionUser()

    if (options.json) {
        console.log(formatJson({ status: status ?? null }))
        return
    }

    console.log(status ? formatStatus(status) : 'No status set.')
}

import { getCommsClient } from '../../lib/api.js'
import type { MutationOptions } from '../../lib/options.js'
import { printDryRun } from '../../lib/output.js'
import { formatStatus, formatStatusJson } from './helpers.js'

export async function clearStatus(options: MutationOptions): Promise<void> {
    if (options.dryRun) {
        printDryRun('clear status')
        return
    }

    const client = await getCommsClient()
    const user = await client.users.clearStatus()

    // Exit 1 whenever the server still reports a status, JSON output included.
    if (user.status) {
        process.exitCode = 1
    }

    if (options.json) {
        console.log(formatStatusJson(user, options.full))
        return
    }

    console.log(
        user.status
            ? `Comms still reports a status: ${formatStatus(user.status)}`
            : 'Status cleared.',
    )
}

import { getCommsClient } from '../../lib/api.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'
import { formatStatus } from './helpers.js'

export async function clearStatus(options: MutationOptions): Promise<void> {
    if (options.dryRun) {
        printDryRun('clear status')
        return
    }

    const client = await getCommsClient()
    const user = await client.users.clearStatus()

    if (options.json) {
        console.log(
            options.full
                ? formatJson(user, 'user', true)
                : formatJson({ status: user.status ?? null }),
        )
        return
    }

    if (user.status) {
        console.log(`Comms still reports a status: ${formatStatus(user.status)}`)
        process.exitCode = 1
        return
    }

    console.log('Status cleared.')
}

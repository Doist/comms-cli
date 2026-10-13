import { getCommsClient } from '../../lib/api.js'
import type { MutationOptions } from '../../lib/options.js'
import { formatJson, printDryRun } from '../../lib/output.js'

export async function clearStatus(options: MutationOptions): Promise<void> {
    if (options.dryRun) {
        printDryRun('clear status')
        return
    }

    const client = await getCommsClient()
    const user = await client.users.clearStatus()

    if (options.json) {
        console.log(formatJson({ status: user.status ?? null }))
        return
    }

    console.log('Status cleared.')
}

import { getCommsClient } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
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

    if (user.status) {
        throw new CliError(
            'INVALID_STATE',
            `Comms still reports a status: ${formatStatus(user.status)}`,
        )
    }

    console.log(options.json ? formatStatusJson(user, options.full) : 'Status cleared.')
}

import chalk from 'chalk'
import { type CommsTokenStore, isManualTokenAccount } from '../../lib/auth-provider.js'
import type { ViewOptions } from '../../lib/options.js'
import { formatJson, formatNdjson } from '../../lib/output.js'

export async function listAccounts(options: ViewOptions, store: CommsTokenStore): Promise<void> {
    const records = await store.list()
    // Manual-token snapshots (from `tdc auth token`) have no identity and
    // can't be targeted by `tdc account use|remove` — hide them from
    // listings so users only see actionable rows. `tdc account current`
    // surfaces the active manual-token state separately.
    const rows = records
        .filter(({ account }) => !isManualTokenAccount(account))
        .map(({ account, isDefault }) => ({
            id: account.id,
            label: account.label,
            isDefault,
        }))

    if (options.json) return console.log(formatJson(rows))
    if (options.ndjson) return console.log(formatNdjson(rows))

    if (rows.length === 0) {
        console.log('No stored accounts. Run `tdc auth login` to add one.')
        return
    }

    console.log(`Stored accounts (${rows.length}):`)
    for (const row of rows) {
        const marker = row.isDefault ? chalk.green('*') : ' '
        console.log(`  ${marker} ${chalk.dim(`id:${row.id}`)}  ${row.label}`)
    }
    const defaultRow = rows.find((r) => r.isDefault)
    if (defaultRow) {
        console.log(`Default: ${chalk.dim(`id:${defaultRow.id}`)}  ${defaultRow.label}`)
    }
}

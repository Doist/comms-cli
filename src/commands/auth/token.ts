import { createInterface } from 'node:readline'
import chalk from 'chalk'
import { createCommsTokenStore } from '../../lib/auth-provider.js'
import { CliError } from '../../lib/errors.js'
import { isNonInteractive } from '../../lib/global-args.js'
import { logTokenStorageResult } from './helpers.js'

function promptHiddenInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        })
        // biome-ignore lint/suspicious/noExplicitAny: accessing private readline property
        const origWrite = (rl as any)._writeToOutput
        // biome-ignore lint/suspicious/noExplicitAny: accessing private readline property
        ;(rl as any)._writeToOutput = (str: string) => {
            if (str.includes(prompt)) {
                origWrite.call(rl, prompt)
            }
        }
        rl.question(prompt, (answer) => {
            rl.close()
            process.stdout.write('\n')
            resolve(answer)
        })
    })
}

// Tokens are read interactively or from the COMMS_API_TOKEN env var only —
// never accepted as a CLI argument. Passing secrets on the command line
// would leak them via process lists and shell history (Doist Secrets
// Management Standard).
export async function loginWithToken(): Promise<void> {
    if (isNonInteractive()) {
        throw new CliError(
            'NO_TOKEN',
            'Cannot prompt for token in non-interactive mode. Set the COMMS_API_TOKEN environment variable instead.',
        )
    }
    const token = await promptHiddenInput('API token: ')
    const trimmed = token.trim()
    if (!trimmed) {
        throw new CliError('NO_TOKEN', 'No token provided', [
            'Run: cm auth token (interactive prompt)',
            'Or set COMMS_API_TOKEN environment variable',
            'Or use OAuth: cm auth login',
        ])
    }
    // Manual token entry has no identity (no API call to resolve the user).
    // Persist the empty-id account; `UserRecordStore.upsert` writes
    // `authUserId: undefined` for it and the synthesised record is what later
    // `active()` / `list()` reads will return.
    const store = createCommsTokenStore()
    await store.set({ id: '', label: '', authMode: 'unknown', authScope: '' }, trimmed)
    console.log(chalk.green('✓'), 'API token saved successfully!')
    const result = store.getLastStorageResult()
    if (result) {
        logTokenStorageResult(result, 'Token stored securely in the system credential manager')
    }
}

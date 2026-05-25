import type { TokenStorageResult } from '@doist/cli-core/auth'
import chalk from 'chalk'

/**
 * Surface a `TokenStorageResult` from a save/clear operation: the
 * human-readable confirmation goes to stdout, any keyring-fallback warning
 * goes to stderr. Pass `isMachineOutput: true` when the command is in
 * `--json` / `--ndjson` mode so the stdout confirmation is suppressed and
 * the warning still reaches the operator on stderr.
 */
export function logTokenStorageResult(
    result: TokenStorageResult,
    secureStoreMessage: string,
    isMachineOutput = false,
): void {
    if (!isMachineOutput && result.storage === 'secure-store') {
        console.log(chalk.dim(secureStoreMessage))
    }
    if (result.warning) {
        console.error(chalk.yellow('Warning:'), result.warning)
    }
}

/**
 * Surface the result of a token-store `clear()` (stashed on the adapter via
 * `getLastClearResult`, since cli-core's `clear` can't return it directly).
 * Shared by `auth logout`'s `onCleared` and `account remove`'s `onRemoved` so
 * the confirmation/warning UX can't drift between the two.
 */
export function logStoredTokenRemoval(
    store: { getLastClearResult(): TokenStorageResult | undefined },
    view: { json?: boolean; ndjson?: boolean },
): void {
    const result = store.getLastClearResult()
    if (!result) return
    logTokenStorageResult(
        result,
        'Stored token removed from the system credential manager',
        view.json || view.ndjson,
    )
}

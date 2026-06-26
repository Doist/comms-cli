import { type CommsRequestError, fetchNewCommsUrls } from '@doist/comms-sdk'
import { CliError } from '../../lib/errors.js'
import { readStdin } from '../../lib/input.js'
import { colors, formatJson, formatNdjson } from '../../lib/output.js'
import { withSpinner } from '../../lib/spinner.js'

type MigrateUrlsOptions = {
    twistToken?: string
    json?: boolean
    ndjson?: boolean
}

/** Serialisable shape of a single URL migration result for JSON/NDJSON output. */
type MigrateUrlsResult = {
    oldUrl: string
    newUrl?: string
    error?: { code: string; message: string }
}

/**
 * Pulls the machine-readable error code out of a {@link CommsRequestError}.
 *
 * Not-migratable URLs come back as `{ error: { code: 'invalid_url' } }` (400) or
 * `{ error: { code: 'not_imported' } }` (404) in `responseData`. Falls back to a
 * stable `API_ERROR` code (the human-readable text stays in `message`) so callers
 * never have to branch on free-form prose.
 */
function extractErrorCode(error: CommsRequestError): string {
    const data = error.responseData
    if (data && typeof data === 'object' && 'error' in data) {
        const inner = (data as { error?: unknown }).error
        if (inner && typeof inner === 'object' && 'code' in inner) {
            const code = (inner as { code?: unknown }).code
            if (typeof code === 'string') return code
        }
    }
    return 'API_ERROR'
}

/** Splits a comma- or whitespace-separated blob into trimmed, non-empty URLs. */
function parseUrls(input: string): string[] {
    return input
        .split(/[\s,]+/)
        .map((url) => url.trim())
        .filter(Boolean)
}

export async function migrateUrls(
    urlsArg: string | undefined,
    options: MigrateUrlsOptions,
): Promise<void> {
    // Flag wins over the environment variable, but the env var is the recommended
    // primary method (a CLI flag exposes the token in process listings).
    const twistToken = options.twistToken ?? process.env.TWIST_AUTH_TOKEN
    if (!twistToken) {
        throw new CliError('NO_TOKEN', 'No Twist token provided.', [
            'Set TWIST_AUTH_TOKEN (e.g. TWIST_AUTH_TOKEN="$(tw auth token view)" — requires the Twist CLI), or',
            'pass --twist-token <token>.',
        ])
    }

    // readStdin() waits briefly for the first byte then reads to end, so an open
    // but empty stdin (CI, spawned children) raises MISSING_CONTENT instead of hanging.
    const rawInput = urlsArg ?? (await readStdin())
    const oldUrls = rawInput ? parseUrls(rawInput) : []
    if (oldUrls.length === 0) {
        throw new CliError('MISSING_CONTENT', 'No URLs provided.', [
            'Pass a comma-separated list as an argument, or pipe URLs via stdin.',
        ])
    }

    // The migration endpoint lives on Twist; honour TWIST_BASE_URL for staging/tests,
    // mirroring the COMMS_BASE_URL convention used for the Comms API.
    const baseUrl = process.env.TWIST_BASE_URL
    const results = await withSpinner({ text: 'Migrating URLs...' }, () =>
        fetchNewCommsUrls({ oldUrls, twistToken }, baseUrl ? { baseUrl } : undefined),
    )

    if (options.json || options.ndjson) {
        const output: MigrateUrlsResult[] = results.map((result) =>
            result.error
                ? {
                      oldUrl: result.oldUrl,
                      error: {
                          code: extractErrorCode(result.error),
                          message: result.error.message,
                      },
                  }
                : { oldUrl: result.oldUrl, newUrl: result.newUrl },
        )
        console.log(options.json ? formatJson(output) : formatNdjson(output))
    } else {
        // Iterate results directly for text output — no need to materialise the
        // simplified shape just to print and tally.
        for (const result of results) {
            if (result.error) {
                const label = colors.error(`✗ ${extractErrorCode(result.error)}`)
                console.log(`${result.oldUrl}  ${label}`)
            } else {
                console.log(`${result.oldUrl} -> ${result.newUrl}`)
            }
        }
    }

    // Surface partial failure to scripts/CI: exit non-zero if any URL failed.
    if (results.some((result) => result.error)) {
        process.exitCode = 1
    }
}

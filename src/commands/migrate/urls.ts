import { type CommsRequestError, fetchNewCommsUrls } from '@doist/comms-sdk'
import { CliError } from '../../lib/errors.js'
import { readStdinToEnd } from '../../lib/input.js'
import { colors, formatJson, formatNdjson } from '../../lib/output.js'

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
 * `{ error: { code: 'not_imported' } }` (404) in `responseData`. Falls back to the
 * error message when the payload doesn't carry a code.
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
    return error.message
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
    // Flag wins over the environment variable.
    const twistToken = options.twistToken ?? process.env.TWIST_AUTH_TOKEN
    if (!twistToken) {
        throw new CliError('NO_TOKEN', 'No Twist token provided.', [
            'Pass --twist-token "$(tw auth token view)" (requires the Twist CLI), or',
            'set the TWIST_AUTH_TOKEN environment variable.',
        ])
    }

    const rawInput = urlsArg ?? (await readStdinToEnd())
    const oldUrls = rawInput ? parseUrls(rawInput) : []
    if (oldUrls.length === 0) {
        throw new CliError('MISSING_CONTENT', 'No URLs provided.', [
            'Pass a comma-separated list as an argument, or pipe URLs via stdin.',
        ])
    }

    // The migration endpoint lives on Twist; honour TWIST_BASE_URL for staging/tests,
    // mirroring the COMMS_BASE_URL convention used for the Comms API.
    const baseUrl = process.env.TWIST_BASE_URL
    const results = await fetchNewCommsUrls(
        { oldUrls, twistToken },
        baseUrl ? { baseUrl } : undefined,
    )

    const output: MigrateUrlsResult[] = results.map((result) =>
        result.error
            ? {
                  oldUrl: result.oldUrl,
                  error: { code: extractErrorCode(result.error), message: result.error.message },
              }
            : { oldUrl: result.oldUrl, newUrl: result.newUrl },
    )

    if (options.json) {
        console.log(formatJson(output))
    } else if (options.ndjson) {
        console.log(formatNdjson(output))
    } else {
        for (const result of output) {
            if (result.newUrl) {
                console.log(`${result.oldUrl} -> ${result.newUrl}`)
            } else {
                console.log(`${result.oldUrl}  ${colors.error(`✗ ${result.error?.code}`)}`)
            }
        }
    }

    // Surface partial failure to scripts/CI: exit non-zero if any URL failed.
    if (output.some((result) => result.error)) {
        process.exitCode = 1
    }
}

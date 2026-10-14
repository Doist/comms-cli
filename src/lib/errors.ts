import { CliError as BaseCliError, type CliErrorCode, type ErrorType } from '@doist/cli-core'
import { CommsRequestError, getCommsErrorString } from '@doist/comms-sdk'

export { BaseCliError }
export type { ErrorType } from '@doist/cli-core'

/**
 * Known error codes used across the CLI.
 * This union provides intellisense suggestions while still accepting any string,
 * allowing dynamic codes and future additions.
 */
export type ErrorCode =
    // Auth & permissions
    | 'AUTH_DCR_FAILED'
    | 'AUTH_FAILED'
    | 'AUTH_REFRESH_EXPIRED'
    | 'AUTH_REFRESH_TRANSIENT'
    | 'AUTH_TOKEN_EXCHANGE_FAILED'
    | 'FORBIDDEN'
    | 'INSUFFICIENT_SCOPE'
    | 'INVALID_CREDENTIAL_STORE'
    | 'INVALID_TOKEN'
    | 'NO_TOKEN'
    | 'READ_ONLY'
    // Validation
    | 'CONFLICTING_OPTIONS'
    | 'INVALID_CURSOR'
    | 'INVALID_DATE'
    | 'INVALID_ID'
    | 'INVALID_LIMIT'
    | 'INVALID_MINUTES'
    | 'INVALID_REF'
    | 'INVALID_REQUEST'
    | 'INVALID_SCOPE'
    | 'INVALID_STATE'
    | 'INVALID_TYPE'
    | 'INVALID_URL'
    | 'INVALID_VALUE'
    | 'MISSING_CONTENT'
    | 'MISSING_YES_FLAG'
    | 'UNKNOWN_KEY'
    | 'INVALID_NAME'
    | 'MISSING_USERS'
    // Not found
    | 'ACCOUNT_NOT_FOUND'
    | 'CHANNEL_NOT_FOUND'
    | 'GROUP_NOT_FOUND'
    | 'NOT_FOUND'
    | 'USER_NOT_FOUND'
    | 'WORKSPACE_NOT_FOUND'
    // Ambiguous matches
    | 'AMBIGUOUS_CHANNEL'
    | 'AMBIGUOUS_GROUP'
    | 'AMBIGUOUS_USER'
    | 'AMBIGUOUS_WORKSPACE'
    // State errors
    | 'ALREADY_INSTALLED'
    | 'BATCH_FAILED'
    | 'PAGINATION_STALLED'
    | 'FILE_NOT_FOUND'
    | 'FILE_READ_ERROR'
    | 'NOT_CREATOR'
    | 'NOT_INSTALLED'
    | 'UNKNOWN_AGENT'
    // API & internal
    | 'API_ERROR'
    | 'CONFLICT'
    | 'INTERNAL_ERROR'
    | 'NETWORK_ERROR'
    | 'RATE_LIMITED'
    // Config file inspection
    | 'CONFIG_READ_FAILED'
    | 'CONFIG_INVALID_JSON'
    | 'CONFIG_INVALID_SHAPE'
    // Escape hatch for dynamic codes
    | (string & {})

function hasCommsStatusInRange(
    error: unknown,
    min: number,
    max: number,
): error is { httpStatusCode: number } {
    return (
        typeof error === 'object' &&
        error !== null &&
        'httpStatusCode' in error &&
        typeof error.httpStatusCode === 'number' &&
        error.httpStatusCode >= min &&
        error.httpStatusCode <= max
    )
}

function hasCommsStatusCode(error: unknown, status: number): error is { httpStatusCode: number } {
    return hasCommsStatusInRange(error, status, status)
}

/**
 * Check whether an error is a Comms API 403 "Insufficient scope" response.
 * The status is read from any error carrying an `httpStatusCode`; the message
 * only from a `CommsRequestError`.
 */
export function isInsufficientScope(error: unknown): boolean {
    return (
        hasCommsStatusCode(error, 403) &&
        (getCommsErrorString(error)?.includes('Insufficient scope') ?? false)
    )
}

/**
 * Check whether an error is a plain workspace-permission 403 — i.e. a 403 that
 * is NOT an OAuth-scope failure. Exclusive with `isInsufficientScope` so the
 * two predicates can be checked in any order without downgrading a scope error
 * to a generic `FORBIDDEN`.
 */
export function isForbidden(error: unknown): boolean {
    return hasCommsStatusCode(error, 403) && !isInsufficientScope(error)
}

/**
 * Check whether an error is a Comms API 401. Comms returns this both for a
 * genuinely bad token and — because `_raise_todoist_rest_error` maps an
 * upstream Todoist `UNAUTHORIZED` onto `INVALID_TOKEN` — for a valid token that
 * lacks the scope a proxied workspace/group write needs. The two are
 * indistinguishable on the wire, so the hint covers both.
 */
export function isInvalidToken(error: unknown): boolean {
    return hasCommsStatusCode(error, 401)
}

/** True for a Comms API 400, the server rejecting the request as malformed or invalid. */
export function isBadRequest(error: unknown): boolean {
    return hasCommsStatusCode(error, 400)
}

/** True for a Comms API 429. */
export function isRateLimited(error: unknown): boolean {
    return hasCommsStatusCode(error, 429)
}

/** True for a Comms API 5xx. */
export function isServerError(error: unknown): error is { httpStatusCode: number } {
    return hasCommsStatusInRange(error, 500, 599)
}

/**
 * True when the SDK had no HTTP status to report: a connection that failed
 * (DNS, refused, reset), a timeout, or a body that could not be read after the
 * headers arrived.
 */
export function isNoResponse(error: unknown): boolean {
    return error instanceof CommsRequestError && error.httpStatusCode === undefined
}

/** True when `error` is a CliError carrying one of the given codes. */
export function isCliErrorCode(error: unknown, ...codes: ErrorCode[]): boolean {
    return error instanceof CliError && codes.includes(error.code)
}

/**
 * Comms-flavoured CliError that preserves the historical positional
 * `(code, message, hints?, type?)` signature used across hundreds of call
 * sites. Internally it forwards to the cli-core options-object form.
 *
 * `code` accepts the local Comms `ErrorCode` union plus any cli-core
 * canonical code (`CliErrorCode`), so call sites like
 * `new CliError('CONFIG_READ_FAILED', …)` still type-check without
 * `CONFIG_*` having to live in the local union.
 */
export class CliError extends BaseCliError<ErrorCode> {
    constructor(
        code: ErrorCode | CliErrorCode,
        message: string,
        hints?: string[],
        type: ErrorType = 'error',
    ) {
        super(code, message, { hints, type })
    }
}

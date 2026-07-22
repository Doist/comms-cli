/**
 * OAuth scope-string parsing, shared by the auth provider (which records the
 * server-granted scope) and the permission guards (which check it).
 *
 * Lives in its own module rather than in `auth-provider.ts` because
 * `permissions.ts` needs it too, and `auth-provider` → `api` → `permissions`
 * would close an import cycle.
 */

/**
 * Split a scope string into its individual scope codes.
 *
 * Scope strings are space-delimited per RFC 6749, but commas are tolerated
 * because some issuers emit them; normalising here keeps every consumer's
 * comparison honest.
 */
export function splitScopeString(scope: string): string[] {
    return scope
        .replaceAll(',', ' ')
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
}

/** Whether a granted scope string contains `scope` as a whole scope code. */
export function hasScope(grantedScope: string, scope: string): boolean {
    return splitScopeString(grantedScope).includes(scope)
}

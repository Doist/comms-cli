import type { CommsAccount } from './auth-provider.js'
import type { AuthMode } from './config.js'

/** Canonical `CommsAccount` factory. Applies the `'unknown'` / `''` defaults. */
export function makeCommsAccount(input: {
    id: string
    label: string
    authMode?: AuthMode
    authScope?: string
    oauthClientId?: string
    authBaseUrl?: string
    authResource?: string
}): CommsAccount {
    return {
        id: input.id,
        label: input.label,
        authMode: input.authMode ?? 'unknown',
        authScope: input.authScope ?? '',
        ...(input.oauthClientId ? { oauthClientId: input.oauthClientId } : {}),
        ...(input.authBaseUrl ? { authBaseUrl: input.authBaseUrl } : {}),
        ...(input.authResource ? { authResource: input.authResource } : {}),
    }
}

/**
 * Adapt a Comms `getSessionUser` payload to a `CommsAccount`. Lives in its
 * own module so `migrate-auth.ts` can import it without pulling in
 * `auth-provider.ts`'s runtime graph.
 */
export function toCommsAccount(
    sessionUser: { id: number; fullName: string },
    metadata: {
        authMode?: AuthMode
        authScope?: string
        oauthClientId?: string
        authBaseUrl?: string
        authResource?: string
    } = {},
): CommsAccount {
    return makeCommsAccount({
        id: String(sessionUser.id),
        label: sessionUser.fullName,
        authMode: metadata.authMode,
        authScope: metadata.authScope,
        oauthClientId: metadata.oauthClientId,
        authBaseUrl: metadata.authBaseUrl,
        authResource: metadata.authResource,
    })
}

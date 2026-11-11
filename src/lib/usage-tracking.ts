import { createUsageTracking } from '@todoist/cli-core'
import type { Command } from 'commander'
import packageJson from '../../package.json' with { type: 'json' }

/**
 * The usage headers every request to Comms (and the Todoist OAuth server)
 * carries, so backend logs can attribute traffic to this CLI, its version and
 * OS, one CLI run, and the command that made it. The header set is cli-core's,
 * shared by every Doist CLI; one tracker per process keeps one session ID.
 */
export const usageTracking = createUsageTracking({
    cliName: 'comms-cli',
    version: packageJson.version,
})

/**
 * Labels each command's API requests with that command. The hook fires for
 * every subcommand under `program`, after Commander has picked the one that
 * runs, so an implicit default (`tdc thread <ref>`) is labelled `thread:view`.
 */
export function trackCommandUsage(program: Command): Command {
    return program.hook('preAction', (_thisCommand, actionCommand) => {
        usageTracking.setCommand(actionCommand)
    })
}

/** Wraps a `fetch` so requests that bypass the SDK carry the usage headers too. */
export function withUsageHeaders(fetchImpl: typeof fetch): typeof fetch {
    return (input, init) => {
        // `fetch(request, { headers })` replaces the Request's own headers, so
        // start from them unless `init` brings headers, which win as with `fetch`.
        const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined)
        return fetchImpl(input, { ...init, headers: usageTracking.mergeHeaders(headers) })
    }
}

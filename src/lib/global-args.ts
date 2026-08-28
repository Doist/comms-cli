/**
 * Per-CLI extension of `@doist/cli-core`'s global-args parser.
 *
 * Layers comms's `--include-private-channels`, `--non-interactive`,
 * `--interactive`, and the `--progress-jsonl <path>` space form on top of
 * the subset of cli-core's canonical shape that comms actually registers
 * with Commander (`--json`, `--ndjson`, `--ids-only`, `--accessible`,
 * `--no-spinner`, `--progress-jsonl[=path]`).
 *
 * cli-core's parser also surfaces `quiet` and `verbose` from argv, but
 * comms does not register `--quiet` or `--verbose` globally (Commander
 * would reject them) — so we drop them from the exported shape to avoid
 * the type/API leak where helpers believe the binary supports them.
 */

import {
    createAccessibleGate,
    createGlobalArgsStore,
    createSpinnerGate,
    type GlobalArgs as CoreGlobalArgs,
    parseGlobalArgs as parseCoreGlobalArgs,
} from '@doist/cli-core'

type CommsSpecificFlags = {
    /** Bare/string/false — see `CommsLocalFlags.progressJsonl` for semantics. */
    progressJsonl: string | true | false
    /** Resolved path for `--progress-jsonl` (any form). `undefined` when bare or absent. */
    progressJsonlPath: string | undefined
    includePrivateChannels: boolean
    nonInteractive: boolean
    interactive: boolean
}

/**
 * Public shape exposed to comms callers. Drops cli-core's `quiet` and
 * `verbose` because comms does not register `--quiet` / `--verbose` with
 * Commander — exposing them in the type would lie about what the binary
 * supports.
 */
export type GlobalArgs = Pick<
    CoreGlobalArgs,
    'json' | 'ndjson' | 'idsOnly' | 'accessible' | 'noSpinner' | 'user'
> &
    CommsSpecificFlags

/**
 * Internal store shape — keeps the full cli-core surface so the shared
 * `createGlobalArgsStore` / `createAccessibleGate` / `createSpinnerGate`
 * helpers still typecheck against `T extends GlobalArgs`. Comms callers
 * see the narrower {@link GlobalArgs} via `parseGlobalArgs`.
 */
type FullArgs = CoreGlobalArgs & CommsSpecificFlags

type CommsLocalFlags = {
    includePrivateChannels: boolean
    nonInteractive: boolean
    interactive: boolean
    /**
     * Resolved value for `--progress-jsonl` across all three forms (bare,
     * `=path`, space-separated `<path>`). `false` = absent, `true` = bare,
     * string = path. Comms parses this locally — and ignores cli-core's
     * `progressJsonl` field — so that "last occurrence wins" stays correct
     * when the forms are mixed (`tdc --progress-jsonl=/a --progress-jsonl /b`
     * → `/b`). cli-core deliberately drops the space form cross-CLI because
     * it can swallow positionals; comms re-adds it because the flag is
     * global, not subcommand-attached.
     */
    progressJsonl: string | true | false
}

function parseCommsLocalFlags(argv: string[]): CommsLocalFlags {
    let includePrivate = false
    let nonInteractive = false
    let interactive = false
    let progressJsonl: string | true | false = false

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--') break
        if (arg === '--include-private-channels') {
            includePrivate = true
        } else if (arg === '--non-interactive') {
            nonInteractive = true
        } else if (arg === '--interactive') {
            interactive = true
        } else if (arg === '--progress-jsonl') {
            // Bare or space form. Last one wins — overwrite any prior value.
            if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
                progressJsonl = argv[i + 1]
                i++
            } else {
                progressJsonl = true
            }
        } else if (arg.startsWith('--progress-jsonl=')) {
            progressJsonl = arg.slice('--progress-jsonl='.length)
        }
    }

    return {
        includePrivateChannels: includePrivate,
        nonInteractive,
        interactive,
        progressJsonl,
    }
}

function parseFullArgs(argv?: string[]): FullArgs {
    const args = argv ?? process.argv
    const base = parseCoreGlobalArgs(args)
    const local = parseCommsLocalFlags(args)

    return {
        ...base,
        progressJsonl: local.progressJsonl,
        progressJsonlPath:
            typeof local.progressJsonl === 'string' ? local.progressJsonl : undefined,
        includePrivateChannels: local.includePrivateChannels,
        nonInteractive: local.nonInteractive,
        interactive: local.interactive,
    }
}

/**
 * Parse well-known global flags from an argv array. Pure — pass an explicit
 * array for testing, or omit to read `process.argv`. Returns the narrowed
 * comms surface; cli-core's `quiet` and `verbose` are intentionally
 * dropped (see {@link GlobalArgs}).
 */
export function parseGlobalArgs(argv?: string[]): GlobalArgs {
    const { quiet: _quiet, verbose: _verbose, ...rest } = parseFullArgs(argv)
    return rest
}

const store = createGlobalArgsStore<FullArgs>(() => parseFullArgs())

/** Clear the cached parse result. Call in test teardown. */
export const resetGlobalArgs = store.reset

// ---------------------------------------------------------------------------
// Query functions — drop-in replacements for the old process.argv checks
// ---------------------------------------------------------------------------

export function isJsonMode(): boolean {
    return store.get().json
}

export function isNdjsonMode(): boolean {
    return store.get().ndjson
}

export function isIdsOnlyMode(): boolean {
    return store.get().idsOnly
}

/** Pre-subcommand `tdc --user <ref>` (see `stripUserFlag` in `src/index.ts`). */
export function getRequestedUserRef(): string | undefined {
    return store.get().user
}

export function isNonInteractive(): boolean {
    const args = store.get()
    if (args.interactive) return false
    if (args.nonInteractive) return true
    return !process.stdin.isTTY
}

export function includePrivateChannels(): boolean {
    const envVal = process.env.COMMS_INCLUDE_PRIVATE_CHANNELS
    if (envVal === '1' || envVal === 'true') {
        return true
    }
    return store.get().includePrivateChannels
}

export function isProgressJsonlEnabled(): boolean {
    return store.get().progressJsonl !== false
}

export function getProgressJsonlPath(): string | undefined {
    return store.get().progressJsonlPath
}

export const isAccessible = createAccessibleGate({
    envVar: 'TDC_ACCESSIBLE',
    getArgs: store.get,
})

export const shouldDisableSpinner = createSpinnerGate({
    envVar: 'TDC_SPINNER',
    getArgs: store.get,
    extraTriggers: () => store.get().nonInteractive,
})

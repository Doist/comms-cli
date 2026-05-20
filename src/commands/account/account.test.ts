import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storeMocks = vi.hoisted(() => ({
    set: vi.fn(),
    clear: vi.fn(),
    active: vi.fn(),
    list: vi.fn(),
    setDefault: vi.fn(),
    getLastStorageResult: vi.fn(),
    getLastClearResult: vi.fn(),
}))

vi.mock('../../lib/auth-provider.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../lib/auth-provider.js')>()
    return {
        ...actual,
        createCommsTokenStore: () => storeMocks,
    }
})

vi.mock('chalk')

import { ACCOUNT_ALAN, ACCOUNT_ELLIE } from '../../lib/__fixtures__/accounts.js'
import type { CommsAccount } from '../../lib/auth-provider.js'
import { TOKEN_ENV_VAR } from '../../lib/auth.js'
import { registerAccountCommand } from './index.js'

function createProgram() {
    const program = new Command()
    program.exitOverride()
    registerAccountCommand(program)
    return program
}

/** Seed `store.list()` and `store.setDefault/clear` resolvers in one call. */
function seedStore(...records: Array<CommsAccount | [CommsAccount, 'default']>): void {
    const list = records.map((spec) =>
        Array.isArray(spec)
            ? { account: spec[0], isDefault: true }
            : { account: spec, isDefault: false },
    )
    storeMocks.list.mockResolvedValue(list)
    storeMocks.setDefault.mockResolvedValue(undefined)
    storeMocks.clear.mockResolvedValue(undefined)
    storeMocks.getLastClearResult.mockReturnValue({ storage: 'secure-store' })
}

describe('account command', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.clearAllMocks()
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleSpy.mockRestore()
        errorSpy.mockRestore()
        vi.unstubAllEnvs()
    })

    const stdout = () => consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')

    describe('list', () => {
        it('renders all stored accounts with the default marker', async () => {
            seedStore([ACCOUNT_ALAN, 'default'], ACCOUNT_ELLIE)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'list'])

            const output = stdout()
            expect(output).toContain('Stored accounts (2)')
            expect(output).toContain('id:1')
            expect(output).toContain('Alan Grant')
            expect(output).toContain('id:2')
            expect(output).toContain('Ellie Sattler')
            expect(output).toContain('Default: id:1  Alan Grant')
        })

        it('runs by default when no subcommand is given (tdc account)', async () => {
            seedStore([ACCOUNT_ALAN, 'default'])

            await createProgram().parseAsync(['node', 'tdc', 'account'])

            expect(stdout()).toContain('Stored accounts (1)')
        })

        it('reports the empty state when no accounts are stored', async () => {
            seedStore()

            await createProgram().parseAsync(['node', 'tdc', 'account', 'list'])

            expect(consoleSpy).toHaveBeenCalledWith(
                'No stored accounts. Run `tdc auth login` to add one.',
            )
        })

        it('emits a JSON envelope with id, label, isDefault', async () => {
            seedStore([ACCOUNT_ALAN, 'default'], ACCOUNT_ELLIE)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'list', '--json'])

            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual([
                { id: '1', label: 'Alan Grant', isDefault: true },
                { id: '2', label: 'Ellie Sattler', isDefault: false },
            ])
        })
    })

    describe('current', () => {
        it('renders the active account from store.active()', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.active.mockResolvedValue({ token: 'tk_abc', account: ACCOUNT_ALAN })

            await createProgram().parseAsync(['node', 'tdc', 'account', 'current'])

            const output = stdout()
            expect(output).toContain('Active account: id:1  Alan Grant')
            expect(output).toContain('Mode:  read-write')
            expect(output).toContain('Scope: user:read')
        })

        it.each([['--json'], ['--ndjson']])(
            'emits {source:"env"} in %s mode without touching store.active',
            async (flag) => {
                vi.stubEnv(TOKEN_ENV_VAR, 'tk_env_supplied')

                await createProgram().parseAsync(['node', 'tdc', 'account', 'current', flag])

                expect(consoleSpy).toHaveBeenCalledTimes(1)
                expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({ source: 'env' })
                expect(storeMocks.active).not.toHaveBeenCalled()
            },
        )

        it('throws NO_TOKEN when nothing is active', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.active.mockResolvedValue(null)

            await expect(
                createProgram().parseAsync(['node', 'tdc', 'account', 'current']),
            ).rejects.toHaveProperty('code', 'NO_TOKEN')
        })

        it('emits a JSON envelope with the active account fields', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.active.mockResolvedValue({ token: 'tk_abc', account: ACCOUNT_ALAN })

            await createProgram().parseAsync(['node', 'tdc', 'account', 'current', '--json'])

            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
                id: '1',
                label: 'Alan Grant',
                authMode: 'read-write',
                authScope: 'user:read',
                source: 'config',
            })
        })

        // `tdc auth token` persists `{ id: '', label: '' }` since manual
        // token entry has no identity. `account current` must render that
        // shape as a distinct "token-only" source, not as a regular account
        // with blank fields.
        const EMPTY_ID_SNAPSHOT = {
            token: 'tk_manual',
            account: { id: '', label: '', authMode: 'unknown' as const, authScope: '' },
        }

        it('renders a token-only notice when active() returns an empty-id snapshot', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.active.mockResolvedValue(EMPTY_ID_SNAPSHOT)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'current'])

            const output = stdout()
            expect(output).toContain('saved via `tdc auth token`')
            // The token-only path must skip the regular `Active account: …`
            // header entirely — otherwise a future change could resurrect a
            // blank-fields render of the empty-id snapshot.
            expect(output).not.toContain('Active account:')
            expect(output).not.toContain('Mode:')
            expect(output).not.toContain('Scope:')
        })

        it('emits {source:"token-only"} in --json mode for empty-id snapshots', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.active.mockResolvedValue(EMPTY_ID_SNAPSHOT)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'current', '--json'])

            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
                source: 'token-only',
            })
        })
    })

    describe('use', () => {
        it('sets the default account by canonical id when the ref matches', async () => {
            seedStore(ACCOUNT_ALAN, [ACCOUNT_ELLIE, 'default'])

            await createProgram().parseAsync(['node', 'tdc', 'account', 'use', '1'])

            expect(storeMocks.setDefault).toHaveBeenCalledTimes(1)
            expect(storeMocks.setDefault).toHaveBeenCalledWith('1')
            const output = stdout()
            expect(output).toContain('Default account set to')
            expect(output).toContain('Alan Grant')
        })

        it('rejects unknown refs with ACCOUNT_NOT_FOUND before touching the store', async () => {
            seedStore([ACCOUNT_ALAN, 'default'])

            await expect(
                createProgram().parseAsync(['node', 'tdc', 'account', 'use', '999']),
            ).rejects.toHaveProperty('code', 'ACCOUNT_NOT_FOUND')

            expect(storeMocks.setDefault).not.toHaveBeenCalled()
        })

        it('matches refs by display name and resolves to the canonical id', async () => {
            seedStore(ACCOUNT_ALAN, [ACCOUNT_ELLIE, 'default'])

            await createProgram().parseAsync(['node', 'tdc', 'account', 'use', 'alan grant'])

            expect(storeMocks.setDefault).toHaveBeenCalledTimes(1)
            const output = stdout()
            expect(output).toContain('Alan Grant')
            expect(output).not.toContain('Ellie Sattler')
        })
    })

    describe('remove', () => {
        it('clears the account by canonical id and prints the removed label', async () => {
            seedStore([ACCOUNT_ALAN, 'default'], ACCOUNT_ELLIE)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'remove', 'ellie sattler'])

            expect(storeMocks.clear).toHaveBeenCalledTimes(1)
            expect(storeMocks.clear).toHaveBeenCalledWith('2')
            const output = stdout()
            expect(output).toContain('Removed account')
            expect(output).toContain('Ellie Sattler')
        })

        it('rejects unknown refs with ACCOUNT_NOT_FOUND before clearing', async () => {
            seedStore([ACCOUNT_ALAN, 'default'])

            await expect(
                createProgram().parseAsync(['node', 'tdc', 'account', 'remove', '999']),
            ).rejects.toHaveProperty('code', 'ACCOUNT_NOT_FOUND')

            expect(storeMocks.clear).not.toHaveBeenCalled()
        })

        it('surfaces keyring-fallback warnings on stderr', async () => {
            seedStore([ACCOUNT_ALAN, 'default'])
            storeMocks.getLastClearResult.mockReturnValue({
                storage: 'config-file',
                warning: 'system credential manager unavailable; local auth state cleared',
            })

            await createProgram().parseAsync(['node', 'tdc', 'account', 'remove', '1'])

            expect(errorSpy).toHaveBeenCalledWith(
                'Warning:',
                'system credential manager unavailable; local auth state cleared',
            )
        })

        it('emits a JSON envelope and suppresses the plain confirmation', async () => {
            seedStore([ACCOUNT_ALAN, 'default'])

            await createProgram().parseAsync(['node', 'tdc', 'account', 'remove', '1', '--json'])

            expect(consoleSpy).toHaveBeenCalledTimes(1)
            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
                id: '1',
                label: 'Alan Grant',
                removed: true,
            })
        })
    })
})

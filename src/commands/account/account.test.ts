import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storeMocks = vi.hoisted(() => ({
    set: vi.fn(),
    clear: vi.fn(),
    active: vi.fn(),
    activeAccount: vi.fn(),
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
import { type CommsAccount, matchCommsAccount } from '../../lib/auth-provider.js'
import { TOKEN_ENV_VAR } from '../../lib/auth.js'
import { CliError } from '../../lib/errors.js'
import { registerAccountCommand } from './index.js'

function createProgram() {
    const program = new Command()
    program.exitOverride()
    registerAccountCommand(program)
    return program
}

/**
 * Seed an in-memory store that mirrors the real keyring store closely enough
 * for the cli-core attachers: `setDefault` / `clear` resolve the raw `<ref>`
 * through `matchCommsAccount` (id / id:N / display name), mutate the shared
 * list, and `clear` returns the `ClearedAccount` the remove attacher needs.
 */
function seedStore(...records: Array<CommsAccount | [CommsAccount, 'default']>): void {
    const list = records.map((spec) =>
        Array.isArray(spec)
            ? { account: spec[0], isDefault: true }
            : { account: spec, isDefault: false },
    )
    storeMocks.list.mockResolvedValue(list)
    storeMocks.setDefault.mockImplementation(async (ref: string) => {
        const match = list.find((entry) => matchCommsAccount(entry.account, ref))
        if (!match) throw new CliError('ACCOUNT_NOT_FOUND', `No stored account matches "${ref}".`)
        for (const entry of list) entry.isDefault = entry === match
    })
    storeMocks.clear.mockImplementation(async (ref: string) => {
        const index = list.findIndex((entry) => matchCommsAccount(entry.account, ref))
        if (index < 0) return null
        const [removed] = list.splice(index, 1)
        return { account: removed.account, wasDefault: removed.isDefault }
    })
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

        it('emits the cli-core {accounts, default} envelope', async () => {
            seedStore([ACCOUNT_ALAN, 'default'], ACCOUNT_ELLIE)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'list', '--json'])

            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
                accounts: [
                    { account: ACCOUNT_ALAN, isDefault: true },
                    { account: ACCOUNT_ELLIE, isDefault: false },
                ],
                default: '1',
            })
        })
    })

    describe('current', () => {
        it('renders the active account resolved by the store', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.activeAccount.mockResolvedValue({ account: ACCOUNT_ALAN, isDefault: true })

            await createProgram().parseAsync(['node', 'tdc', 'account', 'current'])

            const output = stdout()
            expect(output).toContain('Active account: id:1  Alan Grant')
            expect(output).toContain('Mode:  read-write')
            expect(output).toContain('Scope: user:read')
        })

        it('emits a JSON envelope with the active account fields', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.activeAccount.mockResolvedValue({ account: ACCOUNT_ALAN, isDefault: true })

            await createProgram().parseAsync(['node', 'tdc', 'account', 'current', '--json'])

            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
                id: '1',
                label: 'Alan Grant',
                authMode: 'read-write',
                authScope: 'user:read',
                source: 'config',
            })
        })

        it.each([['--json'], ['--ndjson']])(
            'emits {source:"env"} in %s mode when COMMS_API_TOKEN is set',
            async (flag) => {
                vi.stubEnv(TOKEN_ENV_VAR, 'tk_env_supplied')
                storeMocks.activeAccount.mockResolvedValue(null)

                await createProgram().parseAsync(['node', 'tdc', 'account', 'current', flag])

                expect(consoleSpy).toHaveBeenCalledTimes(1)
                expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({ source: 'env' })
            },
        )

        it('throws NO_TOKEN when nothing is active', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.activeAccount.mockResolvedValue(null)

            await expect(
                createProgram().parseAsync(['node', 'tdc', 'account', 'current']),
            ).rejects.toHaveProperty('code', 'NO_TOKEN')
        })

        // `tdc auth token` persists `{ id: '', label: '' }` since manual token
        // entry has no identity. It stays a real store account, so
        // `activeAccount()` resolves it — `account current` must render that
        // shape as a distinct "token-only" source, not as blank account fields.
        const MANUAL_TOKEN_RECORD = {
            account: { id: '', label: '', authMode: 'unknown' as const, authScope: '' },
            isDefault: true,
        }

        it('renders a token-only notice for an identity-less manual-token account', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.activeAccount.mockResolvedValue(MANUAL_TOKEN_RECORD)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'current'])

            const output = stdout()
            expect(output).toContain('saved via `tdc auth token`')
            // The token-only path must skip the regular `Active account: …`
            // header entirely — otherwise a future change could resurrect a
            // blank-fields render of the empty-id account.
            expect(output).not.toContain('Active account:')
            expect(output).not.toContain('Mode:')
            expect(output).not.toContain('Scope:')
        })

        it('emits {source:"token-only"} in --json mode for a manual-token account', async () => {
            vi.stubEnv(TOKEN_ENV_VAR, '')
            storeMocks.activeAccount.mockResolvedValue(MANUAL_TOKEN_RECORD)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'current', '--json'])

            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
                source: 'token-only',
            })
        })
    })

    describe('use', () => {
        it('sets the default account and echoes the ref in human mode', async () => {
            seedStore(ACCOUNT_ALAN, [ACCOUNT_ELLIE, 'default'])

            await createProgram().parseAsync(['node', 'tdc', 'account', 'use', '1'])

            expect(storeMocks.setDefault).toHaveBeenCalledTimes(1)
            expect(storeMocks.setDefault).toHaveBeenCalledWith('1')
            expect(stdout()).toContain('Default account set to 1')
        })

        it('propagates ACCOUNT_NOT_FOUND from the store on an unknown ref', async () => {
            seedStore([ACCOUNT_ALAN, 'default'])

            await expect(
                createProgram().parseAsync(['node', 'tdc', 'account', 'use', '999']),
            ).rejects.toHaveProperty('code', 'ACCOUNT_NOT_FOUND')
        })

        it('resolves a display-name ref to the canonical default id under --json', async () => {
            seedStore(ACCOUNT_ALAN, [ACCOUNT_ELLIE, 'default'])

            await createProgram().parseAsync([
                'node',
                'tdc',
                'account',
                'use',
                'alan grant',
                '--json',
            ])

            expect(storeMocks.setDefault).toHaveBeenCalledWith('alan grant')
            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
                ok: true,
                default: '1',
            })
        })

        it('emits nothing on success under --ndjson', async () => {
            seedStore(ACCOUNT_ALAN, [ACCOUNT_ELLIE, 'default'])

            await createProgram().parseAsync(['node', 'tdc', 'account', 'use', '1', '--ndjson'])

            expect(storeMocks.setDefault).toHaveBeenCalledWith('1')
            expect(consoleSpy).not.toHaveBeenCalled()
        })
    })

    describe('remove', () => {
        it('clears the account by ref and prints the removed label', async () => {
            seedStore([ACCOUNT_ALAN, 'default'], ACCOUNT_ELLIE)

            await createProgram().parseAsync(['node', 'tdc', 'account', 'remove', 'ellie sattler'])

            expect(storeMocks.clear).toHaveBeenCalledTimes(1)
            expect(storeMocks.clear).toHaveBeenCalledWith('ellie sattler')
            expect(stdout()).toContain('Removed Ellie Sattler')
        })

        it('surfaces ACCOUNT_NOT_FOUND when the store reports no match', async () => {
            seedStore([ACCOUNT_ALAN, 'default'])

            await expect(
                createProgram().parseAsync(['node', 'tdc', 'account', 'remove', '999']),
            ).rejects.toHaveProperty('code', 'ACCOUNT_NOT_FOUND')
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

        it('emits the cli-core {ok, removed} envelope and suppresses the plain confirmation', async () => {
            seedStore([ACCOUNT_ALAN, 'default'])

            await createProgram().parseAsync(['node', 'tdc', 'account', 'remove', '1', '--json'])

            expect(consoleSpy).toHaveBeenCalledTimes(1)
            expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
                ok: true,
                removed: '1',
            })
        })
    })
})

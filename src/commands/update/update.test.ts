import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../../../package.json' with { type: 'json' }

vi.mock('chalk')

describe('update wrapper', () => {
    let tmpConfigPath: string

    beforeEach(() => {
        tmpConfigPath = join(mkdtempSync(join(tmpdir(), 'comms-update-test-')), 'config.json')
        vi.doMock('../../lib/config.js', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../../lib/config.js')>()
            return { ...actual, getConfigPath: () => tmpConfigPath }
        })
    })

    afterEach(() => {
        vi.doUnmock('@doist/cli-core/commands')
        vi.doUnmock('../../lib/config.js')
        vi.resetModules()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('forwards comms-cli wiring (packageName, version, configPath, changelog hint, spinner) to cli-core', async () => {
        const registerCoreSpy = vi.fn((program: Command, _options: unknown) => {
            program.command('update')
        })
        vi.doMock('@doist/cli-core/commands', () => ({
            registerUpdateCommand: registerCoreSpy,
            // Re-exported by src/lib/update.ts — must still resolve when the
            // mocked module is loaded transitively via the wrapper.
            fetchLatestVersion: vi.fn(),
            compareVersions: vi.fn(),
            isNewer: vi.fn(),
            parseVersion: vi.fn(),
            getInstallTag: vi.fn(),
            getConfiguredUpdateChannel: vi.fn(),
        }))

        const { registerUpdateCommand } = await import('./index.js')
        const { withSpinner } = await import('../../lib/spinner.js')
        const program = new Command()
        registerUpdateCommand(program)

        expect(registerCoreSpy).toHaveBeenCalledTimes(1)
        const [passedProgram, options] = registerCoreSpy.mock.calls[0]
        expect(passedProgram).toBe(program)
        expect(options).toEqual({
            packageName: packageJson.name,
            currentVersion: packageJson.version,
            configPath: tmpConfigPath,
            changelogCommandName: 'tdc changelog',
            withSpinner,
        })
    })

    it('surfaces INVALID_UPDATE_CHANNEL when on-disk update_channel is unknown', async () => {
        writeFileSync(tmpConfigPath, JSON.stringify({ update_channel: 'beta' }))
        vi.stubGlobal('fetch', vi.fn())

        const { registerUpdateCommand } = await import('./index.js')
        const program = new Command()
        program.exitOverride()
        registerUpdateCommand(program)

        await expect(
            program.parseAsync(['node', 'tdc', 'update', '--check']),
        ).rejects.toMatchObject({ code: 'INVALID_UPDATE_CHANNEL' })
    })
})

describe('tdc update moves the install to @todoist/comms-cli', () => {
    const NPM_SCRIPT = '/usr/local/lib/node_modules/@doist/comms-cli/dist/index.js'
    const PNPM_SCRIPT =
        '/home/user/.local/share/pnpm/global/5/node_modules/@doist/comms-cli/dist/index.js'
    const originalScript = process.argv[1]
    const originalExecPath = process.execPath

    let tmpConfigPath: string
    let spawnMock: ReturnType<typeof vi.fn>
    let fetchMock: ReturnType<typeof vi.fn>
    let stdout: string[]
    let stderr: string[]

    /** Each spawned command exits with the next code in the list. */
    function exitCodes(...codes: number[]) {
        for (const code of codes) {
            spawnMock.mockImplementationOnce(() => {
                const child = new EventEmitter()
                queueMicrotask(() => child.emit('close', code))
                return child
            })
        }
    }

    function spawnedCommands(): string[][] {
        return spawnMock.mock.calls.map(([command, args]) => [command, ...args])
    }

    async function runTdc(...args: string[]) {
        const { registerUpdateCommand } = await import('./index.js')
        const program = new Command()
        program.exitOverride()
        registerUpdateCommand(program)
        await program.parseAsync(['node', 'tdc', ...args])
    }

    beforeEach(() => {
        tmpConfigPath = join(mkdtempSync(join(tmpdir(), 'comms-update-test-')), 'config.json')
        vi.doMock('../../lib/config.js', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../../lib/config.js')>()
            return { ...actual, getConfigPath: () => tmpConfigPath }
        })
        spawnMock = vi.fn()
        vi.doMock('node:child_process', () => ({ spawn: spawnMock }))
        fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ version: '5.0.1' }),
        })
        vi.stubGlobal('fetch', fetchMock)
        // Package-manager detection reads these; pin them so the host's own
        // npm/pnpm setup can't leak in.
        vi.stubEnv('npm_execpath', '')
        process.argv[1] = NPM_SCRIPT
        process.execPath = '/usr/local/bin/node'

        stdout = []
        stderr = []
        vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
            stdout.push(String(line))
        })
        vi.spyOn(console, 'error').mockImplementation((line?: unknown) => {
            stderr.push(String(line))
        })
    })

    afterEach(() => {
        process.argv[1] = originalScript
        process.execPath = originalExecPath
        vi.doUnmock('node:child_process')
        vi.doUnmock('../../lib/config.js')
        vi.resetModules()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    it('uninstalls @doist/comms-cli, then installs @todoist/comms-cli@latest with npm', async () => {
        exitCodes(0, 0)

        await runTdc('update')

        expect(fetchMock).toHaveBeenCalledWith(
            'https://registry.npmjs.org/@todoist/comms-cli/latest',
        )
        expect(spawnedCommands()).toEqual([
            ['npm', 'uninstall', '-g', '@doist/comms-cli'],
            ['npm', 'install', '-g', '@todoist/comms-cli@latest'],
        ])
        expect(spawnMock).toHaveBeenCalledWith(
            'npm',
            ['install', '-g', '@todoist/comms-cli@latest'],
            expect.objectContaining({ stdio: 'inherit' }),
        )
        expect(stdout).toEqual([
            `tdc has moved to @todoist/comms-cli. Replacing @doist/comms-cli v${packageJson.version} with @todoist/comms-cli v5.0.1.`,
            '$ npm uninstall -g @doist/comms-cli',
            '$ npm install -g @todoist/comms-cli@latest',
            '✓ Installed @todoist/comms-cli v5.0.1',
            '  tdc keeps working with the same config and login.',
        ])
    })

    it('uses pnpm remove / pnpm add for a pnpm global install', async () => {
        process.argv[1] = PNPM_SCRIPT
        exitCodes(0, 0)

        await runTdc('update')

        expect(spawnedCommands()).toEqual([
            ['pnpm', 'remove', '-g', '@doist/comms-cli'],
            ['pnpm', 'add', '-g', '@todoist/comms-cli@latest'],
        ])
    })

    it('installs the next dist-tag on the pre-release channel', async () => {
        writeFileSync(tmpConfigPath, JSON.stringify({ update_channel: 'pre-release' }))
        exitCodes(0, 0)

        await runTdc('update')

        expect(fetchMock).toHaveBeenCalledWith('https://registry.npmjs.org/@todoist/comms-cli/next')
        expect(spawnedCommands()).toEqual([
            ['npm', 'uninstall', '-g', '@doist/comms-cli'],
            ['npm', 'install', '-g', '@todoist/comms-cli@next'],
        ])
    })

    it('reinstalls the old package when installing the new one fails', async () => {
        exitCodes(0, 1, 0)

        const result = runTdc('update')

        await expect(result).rejects.toMatchObject({
            code: 'UPDATE_INSTALL_FAILED',
            message: `Could not install @todoist/comms-cli (npm exited with code 1). @doist/comms-cli v${packageJson.version} was reinstalled, so tdc still works.`,
            hints: [
                'To switch by hand, run `npm uninstall -g @doist/comms-cli` and then `npm install -g @todoist/comms-cli@latest`',
                'If it was a permissions error, run the commands with sudo',
            ],
        })
        expect(spawnedCommands()).toEqual([
            ['npm', 'uninstall', '-g', '@doist/comms-cli'],
            ['npm', 'install', '-g', '@todoist/comms-cli@latest'],
            ['npm', 'install', '-g', `@doist/comms-cli@${packageJson.version}`],
        ])
        expect(stderr).toEqual([
            `Installing @todoist/comms-cli failed (npm exited with code 1). Reinstalling @doist/comms-cli v${packageJson.version}...`,
        ])
        expect(stdout).not.toContain('✓ Installed @todoist/comms-cli v5.0.1')
    })

    it('says tdc may be missing when the reinstall fails too', async () => {
        process.argv[1] = PNPM_SCRIPT
        exitCodes(0, 1, 1)

        await expect(runTdc('update')).rejects.toMatchObject({
            code: 'UPDATE_INSTALL_FAILED',
            message: `Could not install @todoist/comms-cli (pnpm exited with code 1), and reinstalling @doist/comms-cli v${packageJson.version} failed too (pnpm exited with code 1), so tdc may not be installed.`,
            hints: [
                'To switch by hand, run `pnpm add -g @todoist/comms-cli@latest`',
                'If it was a permissions error, run the commands with sudo',
            ],
        })
        expect(spawnedCommands()[2]).toEqual([
            'pnpm',
            'add',
            '-g',
            `@doist/comms-cli@${packageJson.version}`,
        ])
    })

    it('stops before installing when the uninstall fails', async () => {
        exitCodes(1)

        await expect(runTdc('update')).rejects.toMatchObject({
            code: 'UPDATE_INSTALL_FAILED',
            message: 'Could not remove @doist/comms-cli (npm exited with code 1).',
        })
        expect(spawnedCommands()).toEqual([['npm', 'uninstall', '-g', '@doist/comms-cli']])
    })

    it('changes nothing when the registry lookup fails', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 404 })

        await expect(runTdc('update')).rejects.toMatchObject({
            code: 'UPDATE_CHECK_FAILED',
            message:
                'Could not look up @todoist/comms-cli@latest: Registry request failed (HTTP 404). Nothing was changed.',
        })
        expect(spawnMock).not.toHaveBeenCalled()
    })

    it('--check reports the move without touching the registry or the install', async () => {
        await runTdc('update', '--check')

        expect(fetchMock).not.toHaveBeenCalled()
        expect(spawnMock).not.toHaveBeenCalled()
        expect(stdout).toEqual([
            `tdc has moved to @todoist/comms-cli (you have @doist/comms-cli v${packageJson.version}).`,
            'Run tdc update to switch, or run:',
            '  npm uninstall -g @doist/comms-cli',
            '  npm install -g @todoist/comms-cli@latest',
        ])
    })

    it('--check --json reports the move for the configured channel', async () => {
        writeFileSync(tmpConfigPath, JSON.stringify({ update_channel: 'pre-release' }))

        await runTdc('update', '--check', '--json')

        expect(spawnMock).not.toHaveBeenCalled()
        expect(JSON.parse(stdout.join('\n'))).toEqual({
            currentVersion: packageJson.version,
            channel: 'pre-release',
            movedTo: '@todoist/comms-cli',
            updateAvailable: true,
            command: 'tdc update',
            manualCommands: [
                'npm uninstall -g @doist/comms-cli',
                'npm install -g @todoist/comms-cli@next',
            ],
        })
    })

    it('update --ndjson reports the move instead of installing', async () => {
        await runTdc('update', '--ndjson')

        expect(fetchMock).not.toHaveBeenCalled()
        expect(spawnMock).not.toHaveBeenCalled()
        expect(stdout).toHaveLength(1)
        expect(JSON.parse(stdout[0])).toEqual({
            currentVersion: packageJson.version,
            channel: 'stable',
            movedTo: '@todoist/comms-cli',
            installed: false,
            command: 'tdc update',
            manualCommands: [
                'npm uninstall -g @doist/comms-cli',
                'npm install -g @todoist/comms-cli@latest',
            ],
        })
    })

    it('--channel still shows the update channel', async () => {
        await runTdc('update', '--channel')

        expect(stdout).toEqual(['Update channel: stable'])
        expect(spawnMock).not.toHaveBeenCalled()
    })

    it('update switch still changes the channel', async () => {
        await runTdc('update', 'switch', '--pre-release', '--json')

        expect(JSON.parse(stdout.join('\n'))).toEqual({ channel: 'pre-release' })
        expect(JSON.parse(readFileSync(tmpConfigPath, 'utf8'))).toMatchObject({
            update_channel: 'pre-release',
        })
        expect(spawnMock).not.toHaveBeenCalled()
    })
})

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createTempRepo, REPO_ROOT } from '../.agents/scripts/lib/test-repo.ts'

it.each(['4.0.1', '4.0.2'])(
    'packs the CLI and a subsequent exact SDK pin %s without running lifecycle scripts',
    (sdkVersion) => {
        const repo = createTempRepo()
        try {
            repo.copyFromCheckout('scripts')
            const manifest = {
                name: '@todoist/comms-cli',
                version: '4.1.0',
                type: 'module',
                bin: { tdc: 'dist/index.js' },
                repository: { url: 'https://github.com/todoist/comms-cli.git' },
                dependencies: { '@todoist/comms-sdk': sdkVersion, '@todoist/cli-core': '1.10.0' },
                files: ['dist', 'scripts/postinstall.js', 'CHANGELOG.md'],
                scripts: { prepare: 'exit 97', postinstall: 'node scripts/postinstall.js' },
                publishConfig: { registry: 'https://wrong.invalid', provenance: true },
            }
            repo.write('package.json', JSON.stringify(manifest))
            repo.write(
                'package-lock.json',
                JSON.stringify({
                    name: manifest.name,
                    packages: { '': { dependencies: manifest.dependencies } },
                }),
            )
            repo.write(
                'dist/index.js',
                "import p from '../package.json' with {type:'json'}; console.log(p.name+' '+p.version)",
            )
            repo.write('dist/postinstall.js', "throw Error('must not execute postinstall')")
            repo.write('README.md', 'Fixture CLI')
            repo.write('LICENSE', 'MIT')
            repo.write('CHANGELOG.md', 'Existing history\n')
            expect(repo.git(['add', '.']).status).toBe(0)
            expect(repo.git(['commit', '-qm', 'fixture']).status).toBe(0)
            const output = join(repo.dir, 'artifact')
            mkdirSync(output)
            const plan = {
                version: '4.1.1',
                branch: 'main',
                sourceSha: repo.git(['rev-parse', 'HEAD']).stdout.trim(),
                notes: '[Posted by Jarvis]\n\n## 4.1.1\n\nMigration',
                runId: '42',
                runAttempt: '1',
            }
            writeFileSync(join(output, 'plan.json'), JSON.stringify(plan))
            const result = repo.run(process.execPath, ['scripts/release.mjs', 'pack', output])
            expect(result.status, result.stderr).toBe(0)
            const metadata = JSON.parse(readFileSync(join(output, 'release.json'), 'utf8'))
            expect(metadata).toMatchObject({
                ...plan,
                name: '@todoist/comms-cli',
                filename: 'todoist-comms-cli-4.1.1.tgz',
            })
            const unpacked = join(repo.dir, 'unpacked')
            mkdirSync(unpacked)
            execFileSync('tar', ['-xzf', join(output, metadata.filename), '-C', unpacked])
            const packed = JSON.parse(readFileSync(join(unpacked, 'package/package.json'), 'utf8'))
            expect(packed.scripts).toEqual({ postinstall: 'node scripts/postinstall.js' })
            expect(packed.publishConfig).toBeUndefined()
            expect(packed.bin).toEqual({ tdc: 'dist/index.js' })
            expect(readFileSync(join(unpacked, 'package/CHANGELOG.md'), 'utf8')).toBe(
                `${plan.notes}\n\nExisting history\n`,
            )
            expect(readFileSync(join(unpacked, 'package/scripts/postinstall.js'), 'utf8')).toBe(
                readFileSync(join(REPO_ROOT, 'scripts/postinstall.js'), 'utf8'),
            )
            const cli = spawnSync(process.execPath, [join(unpacked, 'package/dist/index.js')], {
                encoding: 'utf8',
            })
            expect(cli.status).toBe(0)
            expect(cli.stdout).toBe('@todoist/comms-cli 4.1.1\n')
            expect(
                execFileSync('tar', ['-tzf', join(output, metadata.filename)], {
                    encoding: 'utf8',
                }),
            ).not.toContain('scripts/release.mjs')
            expect(JSON.parse(readFileSync(join(repo.dir, 'package.json'), 'utf8')).version).toBe(
                '4.1.0',
            )
        } finally {
            repo.cleanup()
        }
    },
)

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isolatedEnv } from '../.agents/scripts/lib/test-repo.ts'
import { analyzeCommits, generateNotes } from './release-analysis.mjs'
import { recordStableSource, releaseChannelNote } from './source-release-record.mjs'

// A disposable bare filesystem remote is the Git boundary; never the project remote/main.
function fixture(version = '4.1.0') {
    const directory = mkdtempSync(join(tmpdir(), 'source-record-fixture-'))
    const remote = join(directory, 'remote.git')
    const work = join(directory, 'work')
    mkdirSync(work)
    mkdirSync(join(work, 'skills/comms-cli'), { recursive: true })
    const git = (args: string[], cwd = work) =>
        execFileSync('git', ['-c', 'commit.gpgSign=false', ...args], {
            cwd,
            env: isolatedEnv(),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
    git(['init', '--quiet', '--bare', remote])
    git(['init', '--quiet'])
    git(['checkout', '-b', 'main'])
    git(['config', 'user.name', 'Fixture'])
    git(['config', 'user.email', 'fixture@example.com'])
    const manifest = {
        name: '@todoist/comms-cli',
        version,
        dependencies: { '@todoist/comms-sdk': '4.0.1' },
        userField: 'preserve me',
    }
    const lock = {
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: 3,
        packages: {
            '': { ...manifest },
            'node_modules/example': { version: '1.0.0', integrity: 'fixture-original' },
        },
    }
    const history = '## Existing user history\n\nDo not rewrite these bytes.  \n'
    for (const [name, data] of Object.entries({
        'package.json': `${JSON.stringify(manifest, null, 4)}\n`,
        'package-lock.json': `${JSON.stringify(lock, null, 4)}\n`,
        'CHANGELOG.md': history,
        'skills/comms-cli/SKILL.md': `---\nname: comms-cli\nmetadata:\n  version: ${JSON.stringify(version)}\n---\n# Keep current commands\n`,
        'user.txt': 'original',
    }))
        writeFileSync(join(work, name), data)
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'Original build source'])
    git(['push', remote, 'HEAD:refs/heads/main'])
    const sourceSha = git(['rev-parse', 'HEAD'])
    const metadata = {
        version: '4.1.1',
        branch: 'main',
        sourceSha,
        sha256: 'a'.repeat(64),
        runId: '42',
        runAttempt: '2',
        notes: '[Posted by Jarvis]\n\n## 4.1.1\n\n- Original release notes',
    }
    // A test-only tag proves commitback does not move the original source tag.
    git(['update-ref', 'refs/tags/v4.1.1', sourceSha])
    git(['push', remote, 'refs/tags/v4.1.1'])
    const events: string[][] = []
    const io = {
        execFileSync(bin: string, args: string[], options: any) {
            assert.equal(bin, 'git')
            events.push(args)
            return execFileSync(bin, ['-c', 'commit.gpgSign=false', ...args], {
                ...options,
                env: isolatedEnv(),
                stdio: ['pipe', 'pipe', 'pipe'],
            })
        },
    }
    const record = (opts = {}) => recordStableSource(metadata, { remote, io, ...opts })
    const main = () => git(['rev-parse', 'refs/heads/main'], remote)
    const file = (ref: string, name: string) =>
        execFileSync('git', ['show', `${ref}:${name}`], {
            cwd: remote,
            encoding: 'utf8',
            env: isolatedEnv(),
        })
    const userCommit = () => {
        writeFileSync(join(work, 'user.txt'), 'later user edit')
        git(['add', 'user.txt'])
        git(['commit', '--quiet', '-m', 'Later user history'])
        git(['push', remote, 'HEAD:refs/heads/main'])
        return git(['rev-parse', 'HEAD'])
    }
    return {
        directory,
        remote,
        work,
        git,
        metadata,
        history,
        events,
        io,
        record,
        main,
        file,
        userCommit,
        cleanup: () => rmSync(directory, { recursive: true, force: true }),
    }
}

describe('stable source release record', () => {
    it('does not re-release a generated record containing real breaking-change release notes', async () => {
        const f = fixture()
        try {
            const context = {
                cwd: f.work,
                logger: { log: () => {} },
                options: { repositoryUrl: 'https://github.com/todoist/comms-cli' },
                branch: { name: 'main' },
                lastRelease: { version: '4.1.0', gitTag: 'v4.1.0' },
                nextRelease: { version: '5.0.0', gitTag: 'v5.0.0' },
                commits: [
                    {
                        hash: f.metadata.sourceSha,
                        message:
                            'feat!: change format\n\nBREAKING CHANGE: BREAKING CHANGE: the response format is new',
                    },
                ],
            }
            f.metadata.version = '5.0.0'
            f.metadata.notes = await generateNotes({}, context)
            expect(f.metadata.notes).toContain('* BREAKING CHANGE: the response format is new')
            const record = f.record()
            assert.ok(record)
            const message = f.git(['show', '-s', '--format=%B', record.recordSha], f.remote)
            expect(f.file(record.recordSha, 'CHANGELOG.md')).toContain(f.metadata.notes.trim())
            await expect(
                analyzeCommits(
                    {},
                    {
                        ...context,
                        lastRelease: { version: '5.0.0' },
                        commits: [{ hash: record.recordSha, message }],
                    },
                ),
            ).resolves.toBeNull()
        } finally {
            f.cleanup()
        }
    })

    it('handles the first migration release whose real source versions already equal the artifact', () => {
        const f = fixture('4.1.1')
        try {
            const beforeManifest = f.file(f.main(), 'package.json')
            const beforeLock = f.file(f.main(), 'package-lock.json')
            const result = f.record()
            assert.ok(result)
            expect(f.file(result.recordSha, 'package.json')).toBe(beforeManifest)
            expect(f.file(result.recordSha, 'package-lock.json')).toBe(beforeLock)
            expect(
                f.git(
                    ['diff-tree', '--no-commit-id', '--name-only', '-r', result.recordSha],
                    f.remote,
                ),
            ).toBe('CHANGELOG.md')
        } finally {
            f.cleanup()
        }
    })

    it('records changelog and root versions after the original build while preserving user history and tag', () => {
        const f = fixture()
        try {
            const parent = f.userCommit()
            const result = f.record()
            assert.ok(result)
            expect(result.sourceSha).toBe(f.metadata.sourceSha)
            expect(result.recordSha).toBe(f.main())
            expect(result.recordSha).not.toBe(f.metadata.sourceSha)
            expect(f.git(['rev-parse', `${result.recordSha}^`], f.remote)).toBe(parent)
            expect(f.file(result.recordSha, 'CHANGELOG.md')).toBe(
                `${f.metadata.notes}\n\n${f.history}`,
            )
            expect(JSON.parse(f.file(result.recordSha, 'package.json'))).toEqual({
                name: '@todoist/comms-cli',
                version: '4.1.1',
                dependencies: { '@todoist/comms-sdk': '4.0.1' },
                userField: 'preserve me',
            })
            const lock = JSON.parse(f.file(result.recordSha, 'package-lock.json'))
            expect(lock.version).toBe('4.1.1')
            expect(lock.packages[''].version).toBe('4.1.1')
            expect(lock.packages['node_modules/example']).toEqual({
                version: '1.0.0',
                integrity: 'fixture-original',
            })
            expect(f.file(result.recordSha, 'skills/comms-cli/SKILL.md')).toBe(
                '---\nname: comms-cli\nmetadata:\n  version: "4.1.1"\n---\n# Keep current commands\n',
            )
            expect(f.file(result.recordSha, 'user.txt')).toBe('later user edit')
            expect(f.git(['rev-parse', 'refs/tags/v4.1.1'], f.remote)).toBe(f.metadata.sourceSha)
            expect(f.git(['show', '-s', '--format=%B', result.recordSha], f.remote)).toContain(
                'chore(release): 4.1.1 [skip ci]',
            )
            expect(
                f.events.some(
                    (args) => args.includes('--force') || args.includes('--force-with-lease'),
                ),
            ).toBe(false)
        } finally {
            f.cleanup()
        }
    })
    it('reuses a completed record without adding another changelog entry, commit or push', () => {
        const f = fixture()
        try {
            const first = f.record()
            assert.ok(first)
            f.events.length = 0
            expect(f.record()).toEqual(first)
            expect(f.events.some((args) => args.includes('commit') || args.includes('push'))).toBe(
                false,
            )
            expect(f.file(f.main(), 'CHANGELOG.md')).toBe(`${f.metadata.notes}\n\n${f.history}`)
        } finally {
            f.cleanup()
        }
    })
    it('recovers a lost main-push response without creating another source record', () => {
        const f = fixture()
        try {
            let lost = false
            const io = {
                execFileSync(bin: string, args: string[], options: any) {
                    const result = f.io.execFileSync(bin, args, options)
                    if (args.includes('push') && !lost) {
                        lost = true
                        throw new Error('lost main push response')
                    }
                    return result
                },
            }
            expect(() => f.record({ io })).toThrow('lost main push response')
            const accepted = f.main()
            f.events.length = 0
            expect(f.record()?.recordSha).toBe(accepted)
            expect(f.events.some((args) => args.includes('push'))).toBe(false)
        } finally {
            f.cleanup()
        }
    })
    it('stops on a concurrent main advance and retries on top of the new user commit without force', () => {
        const f = fixture()
        try {
            let raced = false
            let userSha = ''
            const io = {
                execFileSync(bin: string, args: string[], options: any) {
                    if (args.includes('push') && !raced) {
                        raced = true
                        userSha = f.userCommit()
                    }
                    return f.io.execFileSync(bin, args, options)
                },
            }
            expect(() => f.record({ io })).toThrow()
            expect(f.main()).toBe(userSha)
            const result = f.record()
            assert.ok(result)
            expect(f.git(['rev-parse', `${result.recordSha}^`], f.remote)).toBe(userSha)
            expect(f.file(result.recordSha, 'skills/comms-cli/SKILL.md')).toBe(
                '---\nname: comms-cli\nmetadata:\n  version: "4.1.1"\n---\n# Keep current commands\n',
            )
            expect(f.file(result.recordSha, 'user.txt')).toBe('later user edit')
        } finally {
            f.cleanup()
        }
    })
    it('keeps next completely excluded from changelog/version commitback', () => {
        const f = fixture()
        try {
            f.metadata.branch = 'next'
            f.metadata.version = '4.2.0-next.1'
            expect(f.record()).toBeUndefined()
            expect(f.events).toEqual([])
            expect(f.main()).toBe(f.metadata.sourceSha)
            expect(f.file(f.main(), 'CHANGELOG.md')).toBe(f.history)
        } finally {
            f.cleanup()
        }
    })
    it('blocks a new baseline until the stable source record is complete', () => {
        const f = fixture()
        try {
            expect(() => f.record({ verifyOnly: true })).toThrow(/source record is incomplete/)
            expect(f.events.some((args) => args.includes('commit') || args.includes('push'))).toBe(
                false,
            )
            const result = f.record()
            expect(f.record({ verifyOnly: true })).toEqual(result)
        } finally {
            f.cleanup()
        }
    })
    it('rejects a retry with a different original artifact identity', () => {
        const f = fixture()
        try {
            f.record()
            const accepted = f.main()
            f.metadata.sha256 = 'b'.repeat(64)
            expect(f.record).toThrow(/different original bytes/)
            expect(f.main()).toBe(accepted)
        } finally {
            f.cleanup()
        }
    })
})

describe('semantic release channels and separate source identity', () => {
    const metadata = { branch: 'main', version: '4.1.1', sourceSha: 'a'.repeat(40) }
    const record = { version: '4.1.1', sourceSha: metadata.sourceSha, recordSha: 'b'.repeat(40) }
    it('preserves existing note fields/channels and records the generated commit separately', () => {
        const existing = { channels: ['next'], userHistory: { preserve: true } }
        const expected = { ...existing, channels: ['next', null], sourceRecord: record }
        expect(releaseChannelNote(existing, metadata, record)).toEqual(expected)
        expect(releaseChannelNote(expected, metadata, record)).toEqual(expected)
        expect(existing).toEqual({ channels: ['next'], userHistory: { preserve: true } })
    })
    it('records next channel without creating a source record', () => {
        expect(
            releaseChannelNote(
                { channels: [], custom: 1 },
                { ...metadata, branch: 'next' },
                undefined,
            ),
        ).toEqual({ channels: ['next'], custom: 1 })
    })
    it('refuses incomplete or conflicting stable source records before channel updates', () => {
        expect(() => releaseChannelNote({ channels: [] }, metadata, undefined)).toThrow(
            /must complete/,
        )
        expect(() =>
            releaseChannelNote(
                { channels: [null], sourceRecord: { ...record, recordSha: 'c'.repeat(40) } },
                metadata,
                record,
            ),
        ).toThrow(/Never replace/)
        expect(() => releaseChannelNote({ channels: 'invalid' }, metadata, record)).toThrow(
            /Invalid/,
        )
    })
})

describe('actual recorder ordering with external GitHub and registry fixtures', () => {
    it.each(['main', 'next'])(
        'finishes %s with the original artifact identity and idempotent source/channel recording',
        (branch) => {
            const f = fixture()
            try {
                const version = branch === 'main' ? '4.1.1' : '4.2.0-next.1'
                const metadata = {
                    ...f.metadata,
                    branch,
                    version,
                    filename: `todoist-comms-cli-${version}.tgz`,
                }
                if (branch === 'next') {
                    f.git(['update-ref', `refs/tags/v${version}`, metadata.sourceSha])
                    f.git(['push', f.remote, `refs/tags/v${version}`])
                }
                const artifact = join(f.directory, 'artifact')
                mkdirSync(artifact)
                const manifest = JSON.stringify(metadata)
                writeFileSync(join(artifact, 'release.json'), manifest)
                writeFileSync(join(artifact, metadata.filename), 'original-tarball')
                const release = {
                    id: 42,
                    tag_name: `v${version}`,
                    target_commitish: metadata.sourceSha,
                    draft: false,
                    prerelease: branch === 'next',
                    published_at: '2026-11-10T00:00:00Z',
                    body: metadata.notes,
                }
                const assets = [
                    {
                        id: 100,
                        name: metadata.filename,
                        state: 'uploaded',
                        size: Buffer.byteLength('original-tarball'),
                    },
                    {
                        id: 101,
                        name: 'release.json',
                        state: 'uploaded',
                        size: Buffer.byteLength(manifest),
                    },
                ]
                const bin = join(f.directory, 'bin')
                mkdirSync(bin)
                const events = join(f.directory, 'events')
                const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
                const executable = (name: string, body: string) =>
                    writeFileSync(join(bin, name), `#!${process.execPath}\n${body}\n`, {
                        mode: 0o755,
                    })
                const log = `const fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({bin:require('node:path').basename(process.argv[1]),args})+'\\n');`
                executable(
                    'node',
                    log +
                        `if(args[1]==='check-registry') console.log(JSON.stringify({tags:{${branch === 'main' ? 'latest' : 'next'}:${JSON.stringify(version)}}})); else if(args[1]!=='verify') process.exit(91);`,
                )
                executable(
                    'git',
                    log +
                        `const r=require('node:child_process').spawnSync(${JSON.stringify(realGit)},['-c','commit.gpgSign=false',...args.map(x=>x==='https://github.com/todoist/comms-cli.git'?${JSON.stringify(f.remote)}:x)]); if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.status??1);`,
                )
                executable(
                    'gh',
                    log +
                        `const route=args.find(x=>x.startsWith('repos/')); if(args.includes('POST')||args.includes('PATCH')||args.includes('DELETE'))throw Error('unexpected GitHub write'); if(route?.includes('git/matching-refs')) console.log(JSON.stringify([{ref:'refs/tags/v${version}',object:{type:'commit',sha:'${metadata.sourceSha}'}}])); else if(route?.includes('/assets/100'))process.stdout.write('original-tarball');else if(route?.includes('/assets/101'))process.stdout.write(${JSON.stringify(manifest)});else if(route?.includes('/42/assets?'))console.log(JSON.stringify(${JSON.stringify(assets)}));else if(route?.includes('/releases?'))console.log(JSON.stringify([${JSON.stringify(release)}]));else if(route?.endsWith('/releases/42'))console.log(JSON.stringify(${JSON.stringify(release)}));else throw Error('unexpected route '+route);`,
                )
                const output = join(f.directory, 'output')
                const execute = () =>
                    spawnSync(process.execPath, [resolve('scripts/record-release.mjs'), artifact], {
                        cwd: f.work,
                        encoding: 'utf8',
                        env: {
                            ...isolatedEnv(),
                            PATH: `${bin}:${process.env.PATH}`,
                            GITHUB_REPOSITORY: 'todoist/comms-cli',
                            GITHUB_OUTPUT: output,
                        },
                    })
                const result = execute()
                expect(result.status, result.stderr).toBe(0)
                const accepted = f.main()
                if (branch === 'main') {
                    expect(accepted).not.toBe(metadata.sourceSha)
                    expect(JSON.parse(f.file(accepted, 'package.json')).version).toBe('4.1.1')
                    expect(f.file(accepted, 'CHANGELOG.md')).toBe(
                        `${metadata.notes}\n\n${f.history}`,
                    )
                } else {
                    expect(accepted).toBe(metadata.sourceSha)
                    expect(f.file(accepted, 'CHANGELOG.md')).toBe(f.history)
                }
                expect(f.git(['rev-parse', `refs/tags/v${version}`], f.remote)).toBe(
                    metadata.sourceSha,
                )
                const note = JSON.parse(
                    f.git(['notes', '--ref', 'refs/notes/semantic-release', 'show', `v${version}`]),
                )
                expect(note.channels).toEqual([branch === 'main' ? null : 'next'])
                if (branch === 'main')
                    expect(note.sourceRecord).toMatchObject({
                        sourceSha: metadata.sourceSha,
                        recordSha: accepted,
                    })
                else expect(note.sourceRecord).toBeUndefined()
                const commands = readFileSync(events, 'utf8')
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line))
                const firstGit = commands.findIndex((event) => event.bin === 'git')
                const checks = commands
                    .slice(0, firstGit)
                    .filter((event) => event.bin === 'node' && event.args[1] === 'check-registry')
                expect(checks.map((event) => event.args[3])).toEqual(['npmjs', 'github'])
                expect(commands[firstGit - 1]).toMatchObject({ bin: 'gh' })
                expect(execute().status).toBe(0)
                expect(f.main()).toBe(accepted)
                expect(readFileSync(join(artifact, 'release.json'), 'utf8')).toBe(manifest)
                expect(readFileSync(join(artifact, metadata.filename), 'utf8')).toBe(
                    'original-tarball',
                )
            } finally {
                f.cleanup()
            }
        },
    )
})

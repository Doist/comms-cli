import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareRetainedArtifact, downloadRetainedArtifact } from './artifact-source.mjs'

describe('authenticated retained artifact binding', () => {
    it.each(['matching', 'replaced tarball', 'replaced metadata'])(
        'checks %s against the actual selected run artifact',
        (scenario) => {
            const directory = mkdtempSync(join(tmpdir(), 'artifact-fixture-'))
            const filename = 'todoist-comms-cli-4.1.1.tgz'
            const metadata = JSON.stringify({ filename, version: '4.1.1', integrity: 'original' })
            try {
                writeFileSync(
                    join(directory, 'release.json'),
                    scenario === 'replaced metadata'
                        ? metadata.replace('original', 'forged')
                        : metadata,
                )
                writeFileSync(
                    join(directory, filename),
                    scenario === 'replaced tarball' ? 'forged' : 'original',
                )
                const download = (runId: number, artifact: string, target: string) => {
                    expect(runId).toBe(42)
                    expect(artifact).toBe('release-42-2')
                    writeFileSync(join(target, 'release.json'), metadata)
                    writeFileSync(join(target, filename), 'original')
                }
                const verify = () =>
                    compareRetainedArtifact(directory, { id: 42, run_attempt: 2 }, download)
                if (scenario === 'matching') expect(verify).not.toThrow()
                else expect(verify).toThrow(/differs from the authenticated build artifact/)
            } finally {
                rmSync(directory, { recursive: true, force: true })
            }
        },
    )
})

describe('original GitHub archive binding', () => {
    it.each([
        'matching original',
        'archive bytes changed',
        'digest absent',
        'wrong attempt',
        'wrong source',
        'expired',
    ])('checks %s before accepting bootstrap files', (scenario) => {
        const directory = mkdtempSync(join(tmpdir(), 'archive-binding-'))
        try {
            const target = join(directory, 'download')
            mkdirSync(target)
            const filename = 'todoist-comms-cli-4.1.1.tgz'
            const metadata = {
                version: '4.1.1',
                filename,
                runId: '42',
                runAttempt: '2',
                sourceSha: 'a'.repeat(40),
            }
            const manifest = JSON.stringify(metadata)
            writeFileSync(join(directory, 'release.json'), manifest)
            writeFileSync(join(directory, filename), 'original-tarball')
            execFileSync('zip', ['-q', 'fixture.zip', 'release.json', filename], { cwd: directory })
            const archive = readFileSync(join(directory, 'fixture.zip'))
            const artifact = {
                id: 17,
                name: 'release-42-2',
                expired: scenario === 'expired',
                digest:
                    scenario === 'digest absent'
                        ? null
                        : `sha256:${createHash('sha256').update(archive).digest('hex')}`,
                workflow_run: {
                    id: 42,
                    head_sha: scenario === 'wrong source' ? 'b'.repeat(40) : 'a'.repeat(40),
                },
            }
            let extracted = false
            const io = {
                execFileSync(bin: string, args: string[], options: any) {
                    if (bin === 'gh') {
                        if (
                            args[1] ===
                            'repos/todoist/comms-cli/actions/runs/42/artifacts?per_page=100&page=1'
                        )
                            return JSON.stringify({ artifacts: [artifact] })
                        expect(args).toEqual([
                            'api',
                            'repos/todoist/comms-cli/actions/artifacts/17/zip',
                        ])
                        return scenario === 'archive bytes changed'
                            ? Buffer.from('different archive')
                            : archive
                    }
                    expect(bin).toBe('unzip')
                    extracted = true
                    return execFileSync(bin, args, options)
                },
            }
            const check = () =>
                downloadRetainedArtifact(
                    {
                        id: 42,
                        run_attempt: scenario === 'wrong attempt' ? 3 : 2,
                        head_sha: 'a'.repeat(40),
                    },
                    target,
                    io,
                )
            if (scenario === 'matching original') {
                expect(check).not.toThrow()
                expect(readFileSync(join(target, 'release.json'), 'utf8')).toBe(manifest)
                expect(readFileSync(join(target, filename), 'utf8')).toBe('original-tarball')
            } else {
                expect(check).toThrow()
                expect(extracted).toBe(false)
            }
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
})

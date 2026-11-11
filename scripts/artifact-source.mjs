import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { githubPages } from './github-pages.mjs'
import { REPOSITORY, VERSION } from './release-policy.mjs'

export function downloadRetainedArtifact(sourceRun, target, io = { execFileSync }) {
    const request = (path) =>
        JSON.parse(
            io.execFileSync('gh', ['api', `repos/${REPOSITORY}/${path}`], {
                encoding: 'utf8',
                maxBuffer: 16 * 1024 * 1024,
            }),
        )
    const name = `release-${sourceRun.id}-${sourceRun.run_attempt}`
    const artifacts = [
        ...githubPages(`actions/runs/${sourceRun.id}/artifacts`, 'artifacts', request),
    ].filter((item) => item.name === name)
    assert.equal(
        artifacts.length,
        1,
        'Expected the unique original attempt artifact; stop, never rebuild',
    )
    const artifact = artifacts[0]
    assert.equal(
        artifact.expired,
        false,
        'Original artifact expired; stop for original-byte recovery',
    )
    assert.equal(artifact.workflow_run.id, sourceRun.id)
    assert.equal(artifact.workflow_run.head_sha, sourceRun.head_sha)
    assert.match(
        artifact.digest || '',
        /^sha256:[a-f0-9]{64}$/,
        'Original archive digest unavailable; stop for original-byte recovery',
    )
    assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0)
    const archive = io.execFileSync(
        'gh',
        ['api', `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`],
        { maxBuffer: 64 * 1024 * 1024 },
    )
    assert.equal(
        `sha256:${createHash('sha256').update(archive).digest('hex')}`,
        artifact.digest,
        'Downloaded archive differs from authenticated GitHub digest',
    )
    const archivePath = resolve(target, 'source.zip')
    writeFileSync(archivePath, archive, { mode: 0o600 })
    const entries = io
        .execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
        .trim()
        .split('\n')
    const manifest = io.execFileSync('unzip', ['-p', archivePath, 'release.json'], {
        maxBuffer: 1024 * 1024,
    })
    const metadata = JSON.parse(manifest)
    assert.match(metadata.version, VERSION)
    assert.equal(metadata.filename, `todoist-comms-cli-${metadata.version}.tgz`)
    assert.equal(metadata.runId, String(sourceRun.id))
    assert.equal(metadata.runAttempt, String(sourceRun.run_attempt))
    assert.equal(metadata.sourceSha, sourceRun.head_sha)
    assert.deepEqual(
        entries.sort(),
        ['release.json', metadata.filename].sort(),
        'Unsupported original artifact layout; never rebuild a published version',
    )
    writeFileSync(resolve(target, 'release.json'), manifest)
    writeFileSync(
        resolve(target, metadata.filename),
        io.execFileSync('unzip', ['-p', archivePath, metadata.filename], {
            maxBuffer: 64 * 1024 * 1024,
        }),
    )
    rmSync(archivePath)
}

export function compareRetainedArtifact(
    directory,
    sourceRun,
    download = (_runId, _artifact, target) => downloadRetainedArtifact(sourceRun, target),
) {
    const retained = mkdtempSync(resolve(tmpdir(), 'comms-cli-retained-'))
    try {
        download(sourceRun.id, `release-${sourceRun.id}-${sourceRun.run_attempt}`, retained)
        // Authenticate the whole manifest against GitHub's actual run artifact, not its own hashes.
        const manifest = readFileSync(resolve(retained, 'release.json'))
        assert.deepEqual(
            readFileSync(resolve(directory, 'release.json')),
            manifest,
            'Local release metadata differs from the authenticated build artifact',
        )
        const metadata = JSON.parse(manifest)
        assert.match(metadata.version, VERSION)
        assert.equal(metadata.filename, `todoist-comms-cli-${metadata.version}.tgz`)
        assert.deepEqual(
            readFileSync(resolve(directory, metadata.filename)),
            readFileSync(resolve(retained, metadata.filename)),
            'Local tarball differs from the authenticated build artifact',
        )
    } finally {
        rmSync(retained, { recursive: true, force: true })
    }
}

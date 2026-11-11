import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { githubPages } from './github-pages.mjs'
import { REPOSITORY, SHA, VERSION, validateSourceRun } from './release-policy.mjs'
import { recordStableSource } from './source-release-record.mjs'

export function githubReleaseApi() {
    const request = (path, body, method) =>
        JSON.parse(
            execFileSync(
                'gh',
                [
                    'api',
                    `repos/${REPOSITORY}/${path}`,
                    ...(body ? ['--method', method || 'POST', '--input', '-'] : []),
                ],
                { encoding: 'utf8', ...(body ? { input: JSON.stringify(body) } : {}) },
            ),
        )
    return {
        list: () => githubPages('releases'),
        get: (id) => request(`releases/${id}`),
        sourceRun: (id, attempt) => request(`actions/runs/${id}/attempts/${attempt}`),
        workflowId: () => request('actions/workflows/release.yml').id,
        compare: (base, head) => request(`compare/${base}...${head}`),
        sourceRecord: (metadata) => recordStableSource(metadata, { verifyOnly: true }),
        assets: (id) => [...githubPages(`releases/${id}/assets`)],
        readAsset: (id) =>
            execFileSync(
                'gh',
                [
                    'api',
                    '-H',
                    'Accept: application/octet-stream',
                    `repos/${REPOSITORY}/releases/assets/${id}`,
                ],
                { maxBuffer: 64 * 1024 * 1024 },
            ),
        tagSha: (tag) => {
            const refs = request(`git/matching-refs/tags/${tag}`)
            const ref = refs.find((item) => item.ref === `refs/tags/${tag}`)
            if (!ref) return undefined
            assert.equal(ref.object.type, 'commit', 'Unexpected tag object; never replace it')
            return ref.object.sha
        },
        createTag: (tag, sha) => request('git/refs', { ref: `refs/tags/${tag}`, sha }),
        createDraft: (metadata) =>
            request('releases', {
                tag_name: `v${metadata.version}`,
                target_commitish: metadata.sourceSha,
                name: `v${metadata.version}`,
                body: metadata.notes,
                draft: true,
                prerelease: metadata.branch === 'next',
            }),
        upload: (id, name, file) =>
            JSON.parse(
                execFileSync(
                    'gh',
                    [
                        'api',
                        '--method',
                        'POST',
                        `https://uploads.github.com/repos/${REPOSITORY}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
                        '-H',
                        'Content-Type: application/octet-stream',
                        '--input',
                        file,
                    ],
                    { encoding: 'utf8' },
                ),
            ),
        publish: (id, metadata) =>
            request(
                `releases/${id}`,
                {
                    draft: false,
                    make_latest: metadata.branch === 'next' ? 'false' : 'true',
                },
                'PATCH',
            ),
    }
}

export function findRelease(api, tag) {
    const matches = []
    for (const item of api.list()) if (item.tag_name === tag) matches.push(item)
    assert.ok(
        matches.length <= 1,
        `Multiple records for ${tag}; stop for maintainer reconciliation`,
    )
    return matches[0] ? api.get(matches[0].id) : undefined
}

function assertIdentity(release, metadata) {
    assert.match(metadata.version, VERSION)
    assert.match(metadata.sourceSha, SHA)
    assert.ok(['main', 'next'].includes(metadata.branch))
    assert.equal(metadata.version.includes('-next.'), metadata.branch === 'next')
    assert.ok(metadata.notes.startsWith('[Posted by Jarvis]\n\n'))
    assert.equal(
        release.tag_name,
        `v${metadata.version}`,
        'Release tag differs from the original artifact',
    )
    assert.equal(
        release.target_commitish,
        metadata.sourceSha,
        'Release targets another source; never retarget it',
    )
    assert.equal(
        release.prerelease,
        metadata.branch === 'next',
        'Release prerelease state is wrong',
    )
    assert.equal(
        release.body,
        metadata.notes,
        'Release notes differ from original metadata; inspect this same record',
    )
    assert.equal(typeof release.draft, 'boolean')
    if (release.draft)
        assert.equal(release.published_at, null, 'Unexpected draft publication state')
    else
        assert.ok(
            typeof release.published_at === 'string' &&
                Number.isFinite(Date.parse(release.published_at)),
            'Release has no valid published timestamp',
        )
}

function inspectAssets(api, release, metadata, files, allowMissing) {
    const assets = api.assets(release.id)
    assert.ok(
        assets.every((asset) => files.some((file) => file.name === asset.name)),
        'Unexpected release asset; inspect all original assets before any upload',
    )
    const missing = []
    for (const file of files) {
        const matches = assets.filter((asset) => asset.name === file.name)
        assert.ok(matches.length <= 1, `Duplicate release asset ${file.name}`)
        const asset = matches[0]
        if (!asset) {
            assert.ok(
                allowMissing,
                `Published release ${release.id} lacks ${file.name}. Recover original run ${metadata.runId}/${metadata.runAttempt} bytes into this same record; never rebuild, delete, recreate or retag.`,
            )
            missing.push(file)
            continue
        }
        assert.equal(
            asset.state,
            'uploaded',
            `Incomplete release asset ${asset.id} (${file.name}). Stop; retain original run ${metadata.runId}/${metadata.runAttempt} bytes and inspect this same draft without deleting or replacing assets.`,
        )
        assert.equal(
            asset.size,
            file.bytes.length,
            `Release asset ${asset.id} size differs from original bytes`,
        )
        assert.deepEqual(
            api.readAsset(asset.id),
            file.bytes,
            `Release asset ${asset.id} differs from original bytes; never replace it`,
        )
    }
    return missing
}

export function assertPublishedRecord(api, release, metadata, files) {
    assert.ok(
        release,
        `Release v${metadata.version} is not recorded; finish original run ${metadata.runId}/${metadata.runAttempt}`,
    )
    assertIdentity(release, metadata)
    assert.equal(
        release.draft,
        false,
        `Release ${release.id} is still a draft; resume original run ${metadata.runId}/${metadata.runAttempt}`,
    )
    assert.equal(
        api.tagSha(`v${metadata.version}`),
        metadata.sourceSha,
        'Release tag commit differs; never retag',
    )
    inspectAssets(api, release, metadata, files, false)
}

export function releaseFiles(directory, metadata) {
    assert.equal(metadata.filename, `todoist-comms-cli-${metadata.version}.tgz`)
    return [metadata.filename, 'release.json'].map((name) => ({
        name,
        path: resolve(directory, name),
        bytes: readFileSync(resolve(directory, name)),
    }))
}

// A tag can already exist after an interrupted recorder. Check the durable release record
// before treating any of its ancestor runs as completed history, even after Actions expiry.
export async function assertRecordedBaseline(api, tag) {
    const release = findRelease(api, tag)
    assert.ok(release, `Baseline ${tag} has no release record; recover its original run first`)
    assert.equal(release.tag_name, tag)
    assert.equal(
        release.draft,
        false,
        `Baseline ${tag} is still a draft; resume its original run first`,
    )
    assert.ok(
        typeof release.published_at === 'string' &&
            Number.isFinite(Date.parse(release.published_at)),
        'Baseline has no published timestamp',
    )
    if (tag === 'v4.1.0') {
        // The inspected legacy release has no assets. This exception is bound to its exact commit.
        assert.equal(api.tagSha(tag), '7d75593399fb3c4a51aa6dcfa331098ffbfa8b26')
        assert.equal(release.prerelease, false)
        return
    }
    const assets = api.assets(release.id)
    const metadataAssets = assets.filter((asset) => asset.name === 'release.json')
    assert.equal(
        metadataAssets.length,
        1,
        'Baseline lacks unique original release.json; recover original bytes',
    )
    assert.equal(metadataAssets[0].state, 'uploaded')
    const bytes = api.readAsset(metadataAssets[0].id)
    const metadata = JSON.parse(bytes.toString('utf8'))
    assert.equal(tag, `v${metadata.version}`)
    assert.equal(metadata.name, '@todoist/comms-cli')
    assert.equal(metadata.filename, `todoist-comms-cli-${metadata.version}.tgz`)
    assert.match(metadata.runId, /^\d+$/)
    assert.match(metadata.runAttempt, /^\d+$/)
    const tarballs = assets.filter((asset) => asset.name === metadata.filename)
    assert.equal(
        tarballs.length,
        1,
        'Baseline lacks unique original tarball; recover original bytes',
    )
    const tarball = api.readAsset(tarballs[0].id)
    assert.equal(createHash('sha256').update(tarball).digest('hex'), metadata.sha256)
    assert.equal(
        `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
        metadata.integrity,
    )
    assertPublishedRecord(api, release, metadata, [
        { name: 'release.json', bytes },
        { name: metadata.filename, bytes: tarball },
    ])
    const run = api.sourceRun(metadata.runId, metadata.runAttempt)
    assert.equal(String(run.id), metadata.runId)
    assert.equal(String(run.run_attempt), metadata.runAttempt)
    assert.equal(run.head_branch, metadata.branch)
    await validateSourceRun(run, api.workflowId(), metadata.sourceSha, api.compare)
    if (metadata.branch === 'main') api.sourceRecord(metadata)
}

// Caller has already authenticated the source artifact and both registry copies. Every API
// response is re-read before success. No delete, clobber, release recreation or retag operation.
export function completeReleaseRecord(api, metadata, files) {
    const tag = `v${metadata.version}`
    let release = findRelease(api, tag)
    const tagSha = api.tagSha(tag)
    if (release) {
        assertIdentity(release, metadata)
        assert.equal(
            tagSha,
            metadata.sourceSha,
            'Existing release has a missing/different tag; never recreate or retag',
        )
        if (!release.draft) {
            assertPublishedRecord(api, release, metadata, files)
            return false
        }
    } else {
        assert.ok(
            tagSha === undefined || tagSha === metadata.sourceSha,
            'Tag belongs to another source; never retag',
        )
        if (tagSha === undefined) api.createTag(tag, metadata.sourceSha)
        release = api.createDraft(metadata)
        release = api.get(release.id)
        assertIdentity(release, metadata)
        assert.equal(release.draft, true)
    }
    // Check ALL completed assets before uploading any missing ones; a mismatch cannot be hidden
    // by a partially successful retry. Lost upload responses resume against fresh asset listings.
    const missing = inspectAssets(api, release, metadata, files, true)
    for (const file of missing) api.upload(release.id, file.name, file.path)
    release = api.get(release.id)
    assertIdentity(release, metadata)
    assert.equal(release.draft, true, 'Release changed during recovery; inspect before continuing')
    inspectAssets(api, release, metadata, files, false)
    assert.equal(api.tagSha(tag), metadata.sourceSha, 'Tag moved before publication; stop')
    api.publish(release.id, metadata)
    assertPublishedRecord(api, api.get(release.id), metadata, files)
    return true
}

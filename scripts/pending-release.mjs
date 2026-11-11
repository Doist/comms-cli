import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { downloadRetainedArtifact } from './artifact-source.mjs'
import { githubPages } from './github-pages.mjs'
import {
    githubReleaseApi,
    assertRecordedBaseline,
    assertPublishedRecord,
    findRelease,
    releaseFiles,
} from './github-release-record.mjs'
import { validateSourceRun } from './release-policy.mjs'
import { REPOSITORY, VERSION } from './release-policy.mjs'

// Analysis and publication are separate jobs. Do not make two different tarballs for the same
// next version when another push arrives before the earlier artifact's publication is recorded.
export function requireRecordedPlans(plans, isRecorded) {
    for (const plan of plans) {
        assert.match(plan.version, VERSION)
        assert.ok(
            isRecorded(plan),
            `Retained release ${plan.version} from run ${plan.runId} is not recorded. Finish that exact artifact first, then dispatch a new build from the current release branch.`,
        )
    }
}

export function requireUnallocatedVersion(version, tagExists) {
    assert.match(version, VERSION)
    assert.ok(
        !tagExists(`v${version}`),
        `Version ${version} is already tagged; complete its release/channel record before building again`,
    )
}

export async function checkPendingReleases(baselineTag, proposedVersion) {
    const releases = githubReleaseApi()
    await assertRecordedBaseline(releases, baselineTag)
    const api = (path) =>
        JSON.parse(execFileSync('gh', ['api', `repos/${REPOSITORY}/${path}`], { encoding: 'utf8' }))
    requireUnallocatedVersion(
        proposedVersion,
        (tag) =>
            spawnSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { stdio: 'ignore' })
                .status === 0,
    )
    const branch = process.env.GITHUB_REF_NAME
    assert.ok(['main', 'next'].includes(branch))
    const directory = mkdtempSync(resolve(tmpdir(), 'comms-cli-pending-'))
    try {
        for await (const { target } of retainedPlans(branch, directory, {
            request: api,
            beforeBaseline: (sha) =>
                spawnSync('git', ['merge-base', '--is-ancestor', sha, baselineTag], {
                    stdio: 'ignore',
                }).status === 0,
        })) {
            const plan = JSON.parse(readFileSync(resolve(target, 'release.json'), 'utf8'))
            requireRecordedPlans([plan], (metadata) => {
                assertPublishedRecord(
                    releases,
                    findRelease(releases, `v${metadata.version}`),
                    metadata,
                    releaseFiles(target, metadata),
                )
                if (metadata.branch === 'main') releases.sourceRecord(metadata)
                return true
            })
        }
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

// A failed later rerun must not hide an earlier successful attempt's unrecorded artifact.
export async function* retainedPlans(
    branch,
    directory,
    { request, beforeBaseline = () => false, download = downloadRetainedArtifact },
) {
    const workflow = request('actions/workflows/release.yml')
    for (const run of githubPages(
        `actions/workflows/release.yml/runs?branch=${branch}`,
        'workflow_runs',
        request,
    )) {
        if (beforeBaseline(run.head_sha)) continue
        const artifacts = [...githubPages(`actions/runs/${run.id}/artifacts`, 'artifacts', request)]
        const attempts = new Set()
        for (const artifact of artifacts) {
            const match = new RegExp(`^release-${run.id}-([1-9]\\d*)$`).exec(artifact.name)
            if (!match) continue
            assert.ok(
                !attempts.has(match[1]),
                'Duplicate original attempt artifact; inspect before another build',
            )
            attempts.add(match[1])
            assert.equal(
                artifact.expired,
                false,
                'Original artifact expired; recover its bytes before another build',
            )
            const original = request(`actions/runs/${run.id}/attempts/${match[1]}`)
            assert.equal(original.id, run.id)
            assert.equal(String(original.run_attempt), match[1])
            await validateSourceRun(original, workflow.id, run.head_sha, async (base, head) =>
                request(`compare/${base}...${head}`),
            )
            const target = resolve(directory, `${run.id}-${match[1]}`)
            mkdirSync(target)
            download(original, target)
            yield { target, original }
        }
    }
}

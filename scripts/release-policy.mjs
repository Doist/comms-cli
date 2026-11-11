import assert from 'node:assert/strict'

export const REPOSITORY = 'todoist/comms-cli'
export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-next\.([1-9]\d*))?$/
export const SHA = /^[a-f0-9]{40}$/

export function readSourceRun(api, environment = process.env) {
    const id = environment.ARTIFACT_RUN_ID || ''
    const attempt = environment.ARTIFACT_RUN_ATTEMPT || ''
    assert.match(id, /^[1-9]\d*$/)
    assert.match(
        attempt,
        /^[1-9]\d*$/,
        'Select the original successful ARTIFACT_RUN_ATTEMPT; never substitute the latest attempt',
    )
    const run = api(`actions/runs/${id}/attempts/${attempt}`)
    assert.equal(String(run.id), id)
    assert.equal(String(run.run_attempt), attempt)
    return run
}

export async function validateSourceRun(run, workflowId, sourceSha, compare) {
    assert.match(sourceSha, SHA)
    assert.equal(run.repository.full_name.toLowerCase(), REPOSITORY)
    assert.equal(run.head_repository.full_name.toLowerCase(), REPOSITORY)
    assert.equal(run.workflow_id, workflowId)
    assert.equal(run.path, '.github/workflows/release.yml')
    assert.equal(run.status, 'completed')
    assert.equal(run.conclusion, 'success')
    assert.ok(['push', 'workflow_dispatch'].includes(run.event))
    assert.ok(['main', 'next'].includes(run.head_branch))
    // The builder checks out github.sha, with no custom checkout input.
    assert.equal(run.head_sha, sourceSha)
    const comparison = await compare(sourceSha, run.head_branch)
    assert.ok(
        ['ahead', 'identical'].includes(comparison.status),
        'Source is outside reviewed history',
    )
    assert.equal(comparison.merge_base_commit.sha, sourceSha)
}

export function validatePublicationTag(version, tag, tags) {
    assert.match(version, VERSION)
    assert.ok(['latest', 'next', 'migration-recovery'].includes(tag))
    if (tag === 'migration-recovery') return
    assert.equal(version.includes('-next.'), tag === 'next', 'Stable/prerelease channel mismatch')
    const current = tags[tag]
    if (current === undefined) return
    assert.match(current, VERSION, 'Unexpected registry channel; inspect before publishing')
    const parts = (value) =>
        value
            .match(VERSION)
            .slice(1)
            .map((part) => (part === undefined ? null : BigInt(part)))
    const targetParts = parts(version)
    const currentParts = parts(current)
    for (let i = 0; i < 4; i++) {
        if (targetParts[i] === currentParts[i]) continue
        if (targetParts[i] === null) return // stable follows prereleases
        assert.ok(
            currentParts[i] !== null && targetParts[i] > currentParts[i],
            `Refusing to downgrade ${tag}; use migration-recovery for an older missing mirror`,
        )
        return
    }
}

export function registryJson(result) {
    if (result.status === 0) return JSON.parse(result.stdout)
    for (const stream of [result.stdout, result.stderr]) {
        if (!stream) continue
        const text = stream.trim()
        const start = text.startsWith('{') ? 0 : text.lastIndexOf('\n{') + 1
        try {
            if (JSON.parse(text.slice(start)).error?.code === 'E404') return undefined
        } catch {
            /* Non-JSON errors are failures, not absence. */
        }
    }
    throw new Error('Registry lookup failed; check authentication/network before retrying')
}

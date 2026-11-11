import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import semanticRelease from 'semantic-release'
import { checkPendingReleases } from './pending-release.mjs'
import { REPOSITORY } from './release-policy.mjs'

assert.equal(process.env.GITHUB_REPOSITORY?.toLowerCase(), REPOSITORY)
assert.ok(['main', 'next'].includes(process.env.GITHUB_REF_NAME))
assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    process.env.GITHUB_SHA,
)
// semantic-release's dry run checks push authorization but never pushes, tags or publishes.
const result = await semanticRelease()
if (result) await checkPendingReleases(result.lastRelease.gitTag, result.nextRelease.version)
assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    process.env.GITHUB_SHA,
)
if (result) {
    mkdirSync('.tmp/release', { recursive: true })
    writeFileSync(
        '.tmp/release/plan.json',
        JSON.stringify({
            version: result.nextRelease.version,
            notes: result.nextRelease.notes,
            branch: process.env.GITHUB_REF_NAME,
            sourceSha: process.env.GITHUB_SHA,
            runId: process.env.GITHUB_RUN_ID,
            runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        }),
    )
    execFileSync('node', ['scripts/release.mjs', 'pack', '.tmp/release'], { stdio: 'inherit' })
    appendFileSync(process.env.GITHUB_OUTPUT, 'prepared=true\n')
} else {
    appendFileSync(process.env.GITHUB_OUTPUT, 'prepared=false\n')
}

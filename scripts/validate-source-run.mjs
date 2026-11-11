import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { githubPages } from './github-pages.mjs'
import { REPOSITORY, validateSourceRun, readSourceRun } from './release-policy.mjs'

assert.equal(process.env.GITHUB_REPOSITORY?.toLowerCase(), REPOSITORY)
assert.match(process.env.ARTIFACT_RUN_ID || '', /^\d+$/)
const api = (path) =>
    JSON.parse(execFileSync('gh', ['api', `repos/${REPOSITORY}/${path}`], { encoding: 'utf8' }))
const run = readSourceRun(api)
const workflow = api('actions/workflows/release.yml')
await validateSourceRun(run, workflow.id, process.env.RELEASE_SHA, async (base, head) =>
    api(`compare/${base}...${head}`),
)
const artifact = `release-${run.id}-${run.run_attempt}`
const artifacts = [...githubPages(`actions/runs/${run.id}/artifacts`, 'artifacts', api)].filter(
    (item) => item.name === artifact && !item.expired,
)
if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch')
    assert.equal(
        artifacts.length,
        1,
        'Expected one retained artifact; never rebuild a published version',
    )
else assert.ok(artifacts.length <= 1)
appendFileSync(process.env.GITHUB_OUTPUT, `available=${artifacts.length === 1}\n`)

appendFileSync(
    process.env.GITHUB_OUTPUT,
    `artifact=release-${run.id}-${run.run_attempt}\nbranch=${run.head_branch}\n`,
)
console.log(`Validated successful ${run.event} build ${run.id}, checkout ${run.head_sha}`)

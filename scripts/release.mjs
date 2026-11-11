import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareRetainedArtifact } from './artifact-source.mjs'
import { publishArtifact } from './registry-release.mjs'
import { validateSourceRun, readSourceRun, REPOSITORY, VERSION, SHA } from './release-policy.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [command, directory = 'release-artifact', requestedDestination] = process.argv.slice(2)
const destination = command === 'bootstrap-npm' ? 'npmjs' : requestedDestination
const output = resolve(directory)
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))
const hash = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding)
const run = (bin, args, options = {}) =>
    execFileSync(bin, args, { encoding: 'utf8', ...options }).trim()

function inspect(tarball) {
    const files = run('tar', ['-tzf', tarball]).split('\n').sort()
    assert.ok(files.includes('package/dist/index.js'))
    assert.ok(files.includes('package/scripts/postinstall.js'))
    for (const file of files) {
        assert.ok(
            /^package\/(?:package.json|README.md|LICENSE|CHANGELOG.md|scripts\/postinstall.js|dist\/[^\n]+)$/.test(
                file,
            ),
            `Unexpected packed file: ${file}`,
        )
        assert.ok(
            !file.split('/').includes('..') && !file.includes('.test.'),
            `Unsafe packed file: ${file}`,
        )
    }
    const manifest = JSON.parse(run('tar', ['-xOzf', tarball, 'package/package.json']))
    assert.equal(manifest.name, '@todoist/comms-cli')
    assert.match(manifest.version, VERSION)
    assert.equal(manifest.private, undefined)
    // Routing, visibility and provenance belong to each destination, never the shared tarball.
    assert.equal(manifest.publishConfig, undefined)
    assert.deepEqual(manifest.scripts, { postinstall: 'node scripts/postinstall.js' })
    assert.equal(manifest.repository.url, 'https://github.com/todoist/comms-cli.git')
    assert.match(manifest.dependencies['@todoist/comms-sdk'], VERSION)
    assert.match(manifest.dependencies['@todoist/cli-core'], /^\d+\.\d+\.\d+$/)
    assert.ok(!Object.keys(manifest.dependencies).some((name) => name.startsWith('@doist/')))
    assert.deepEqual(manifest.bin, { tdc: 'dist/index.js' })
    const bytes = readFileSync(tarball)
    return {
        name: manifest.name,
        version: manifest.version,
        sha256: hash(bytes, 'sha256', 'hex'),
        integrity: `sha512-${hash(bytes, 'sha512', 'base64')}`,
    }
}

async function verify() {
    const metadata = json(resolve(output, 'release.json'))
    assert.match(process.env.RELEASE_SHA || '', SHA)
    assert.equal(metadata.sourceSha, process.env.RELEASE_SHA)
    assert.match(process.env.ARTIFACT_RUN_ID || '', /^\d+$/)
    const api = (path) => JSON.parse(run('gh', ['api', `repos/${REPOSITORY}/${path}`]))
    const sourceRun = readSourceRun(api)
    await validateSourceRun(
        sourceRun,
        api('actions/workflows/release.yml').id,
        process.env.RELEASE_SHA,
        async (base, head) => api(`compare/${base}...${head}`),
    )
    compareRetainedArtifact(output, sourceRun)
    assert.equal(metadata.runId, String(sourceRun.id))
    assert.equal(metadata.runAttempt, String(sourceRun.run_attempt))
    assert.equal(metadata.branch, sourceRun.head_branch)
    assert.equal(metadata.version.includes('-next.'), metadata.branch === 'next')
    assert.ok(metadata.notes.startsWith('[Posted by Jarvis]\n\n'))
    assert.equal(metadata.filename, `todoist-comms-cli-${metadata.version}.tgz`)
    const tarball = resolve(output, metadata.filename)
    const actual = inspect(tarball)
    for (const key of Object.keys(actual)) assert.equal(metadata[key], actual[key])
    return { metadata, tarball }
}

if (command === 'pack') {
    assert.equal(
        run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }),
        '',
        'Commit reviewed source before packing',
    )
    const sourceSha = run('git', ['rev-parse', 'HEAD'], { cwd: root })
    if (process.env.RELEASE_SHA) {
        assert.match(process.env.RELEASE_SHA, /^[a-f0-9]{40}$/)
        assert.equal(sourceSha, process.env.RELEASE_SHA)
    }
    const plan = json(resolve(output, 'plan.json'))
    assert.equal(plan.sourceSha, sourceSha)
    assert.match(plan.version, VERSION)
    const isolated = mkdtempSync(resolve(tmpdir(), 'comms-cli-pack-'))
    try {
        const manifest = json(resolve(root, 'package.json'))
        const lock = json(resolve(root, 'package-lock.json'))
        assert.equal(lock.name, manifest.name, 'Finalize the genuine new-scope lock first')
        assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies)
        manifest.version = plan.version
        manifest.scripts = { postinstall: 'node scripts/postinstall.js' }
        delete manifest.publishConfig
        delete manifest.devDependencies
        writeFileSync(resolve(isolated, 'package.json'), JSON.stringify(manifest, null, 4))
        mkdirSync(resolve(isolated, 'scripts'))
        for (const file of [
            'dist',
            'scripts/postinstall.js',
            'README.md',
            'LICENSE',
            'CHANGELOG.md',
        ])
            cpSync(resolve(root, file), resolve(isolated, file), { recursive: true })
        if (plan.branch === 'main')
            writeFileSync(
                resolve(isolated, 'CHANGELOG.md'),
                `${plan.notes.trim()}\n\n${readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')}`,
            )
        const [packed] = JSON.parse(
            run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], {
                cwd: isolated,
            }),
        )
        const metadata = {
            ...plan,
            ...inspect(resolve(output, packed.filename)),
            filename: packed.filename,
        }
        writeFileSync(resolve(output, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`)
        rmSync(resolve(output, 'plan.json'))
        console.log(JSON.stringify(metadata, null, 2))
    } finally {
        rmSync(isolated, { recursive: true, force: true })
    }
} else if (command === 'verify') {
    console.log(JSON.stringify((await verify()).metadata, null, 2))
} else if (['publish', 'bootstrap-npm', 'check-registry'].includes(command)) {
    const { metadata, tarball } = await verify()
    const result = publishArtifact({
        metadata,
        tarball,
        destination,
        command,
        tag: process.env.RELEASE_TAG || (metadata.branch === 'next' ? 'next' : 'latest'),
    })
    console.log(JSON.stringify(result))
} else {
    throw new Error(
        'Usage: node scripts/release.mjs pack|verify DIRECTORY, publish DIRECTORY npmjs|github, or bootstrap-npm DIRECTORY',
    )
}

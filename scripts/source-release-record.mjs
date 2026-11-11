import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { stableSourceRecordAssets } from '../release.config.js'
import { REPOSITORY, SHA, VERSION } from './release-policy.mjs'

function identity(metadata) {
    assert.match(metadata.version, VERSION)
    assert.match(metadata.sourceSha, SHA)
    assert.match(metadata.sha256, /^[a-f0-9]{64}$/)
    assert.match(metadata.runId, /^[1-9]\d*$/)
    assert.match(metadata.runAttempt, /^[1-9]\d*$/)
    assert.ok(metadata.notes.startsWith('[Posted by Jarvis]\n\n'))
    const marker = `Comms-Release-Version: ${metadata.version}`
    const artifact = `Comms-Release-Artifact: ${metadata.sourceSha}/${metadata.runId}/${metadata.runAttempt}/sha256:${metadata.sha256}`
    return {
        marker,
        // This commit is AFTER the immutable build tag. Copying notes into its body can turn
        // a quoted BREAKING CHANGE into another release. Full notes live in CHANGELOG/GitHub.
        message: `chore(release): ${metadata.version} [skip ci]\n\n${marker}\n${artifact}\n`,
    }
}

// Update only release versions; preserve current-main dependencies and all prior changelog bytes.
export function sourceRecordFiles(metadata, files) {
    const manifest = JSON.parse(files['package.json'])
    const lock = JSON.parse(files['package-lock.json'])
    assert.equal(manifest.name, '@todoist/comms-cli')
    assert.equal(lock.name, manifest.name)
    assert.equal(lock.packages?.['']?.name, manifest.name)
    assert.equal(lock.version, manifest.version)
    assert.equal(lock.packages[''].version, manifest.version)
    assert.deepEqual(
        lock.packages[''].dependencies,
        manifest.dependencies,
        'Current main lock must be real and synchronized',
    )
    assert.deepEqual(
        lock.packages[''].devDependencies,
        manifest.devDependencies,
        'Current main development lock must be synchronized',
    )
    assert.match(manifest.version, VERSION)
    assert.ok(!manifest.version.includes('-'), 'Stable main source version must be stable')
    const parts = (version) => version.split('.').map(BigInt)
    const current = parts(manifest.version)
    const target = parts(metadata.version)
    const changedPart = current.findIndex((part, i) => part !== target[i])
    assert.ok(
        changedPart === -1 || current[changedPart] < target[changedPart],
        'Never downgrade current main source version',
    )
    const heading = new RegExp(
        `^#{1,6}[ \\t]+(?:\\[)?${metadata.version.replaceAll('.', '\\.')}($|\\]|[ \\t(])`,
        'm',
    )
    assert.ok(
        !heading.test(files['CHANGELOG.md']),
        'Release changelog already exists without a verified source record; inspect original history',
    )
    const skill = files['skills/comms-cli/SKILL.md']
    const frontmatterEnd = skill.indexOf('\n---', 4)
    assert.ok(skill.startsWith('---\n') && frontmatterEnd > 0, 'Missing skill metadata')
    const versionLine = `  version: ${JSON.stringify(manifest.version)}`
    const frontmatter = skill.slice(0, frontmatterEnd)
    assert.equal(frontmatter.split(versionLine).length, 2, 'Skill version must match current main')
    const updatedSkill =
        frontmatter.replace(versionLine, `  version: ${JSON.stringify(metadata.version)}`) +
        skill.slice(frontmatterEnd)
    const result = {
        ...files,
        'skills/comms-cli/SKILL.md': updatedSkill,
        'CHANGELOG.md': `${metadata.notes.trim()}\n\n${files['CHANGELOG.md']}`,
    }
    if (manifest.version !== metadata.version) {
        manifest.version = metadata.version
        lock.version = metadata.version
        lock.packages[''].version = metadata.version
        for (const [name, value] of [
            ['package.json', manifest],
            ['package-lock.json', lock],
        ]) {
            const indent = files[name].match(/\n([ \t]+)"/)?.[1] || '    '
            result[name] =
                `${JSON.stringify(value, null, indent)}${files[name].endsWith('\n') ? '\n' : ''}`
        }
    }
    return result
}

export function releaseChannelNote(existing, metadata, sourceRecord) {
    assert.ok(Array.isArray(existing.channels), 'Invalid existing semantic-release channel note')
    const channels = [...existing.channels]
    const channel = metadata.branch === 'next' ? 'next' : null
    if (!channels.includes(channel)) channels.push(channel)
    if (metadata.branch === 'next') {
        assert.equal(sourceRecord, undefined, 'Never record source files for next')
        return { ...existing, channels }
    }
    assert.ok(sourceRecord, 'Stable source record must complete before channel recording')
    assert.equal(sourceRecord.sourceSha, metadata.sourceSha)
    assert.equal(sourceRecord.version, metadata.version)
    if (existing.sourceRecord !== undefined)
        assert.deepEqual(
            existing.sourceRecord,
            sourceRecord,
            'Never replace a different source record',
        )
    return { ...existing, channels, sourceRecord }
}

// No npm command, repack, tag mutation, force push or source checkout mutation is involved.
// A normal non-force push detects races; retries re-read main and locate the exact prior record.
export function recordStableSource(
    metadata,
    {
        verifyOnly = false,
        remote = `https://github.com/${REPOSITORY}.git`,
        io = { execFileSync },
    } = {},
) {
    assert.ok(['main', 'next'].includes(metadata.branch))
    if (metadata.branch === 'next') {
        assert.ok(metadata.version.includes('-next.'))
        return undefined
    }
    assert.ok(!metadata.version.includes('-'))
    const { marker, message } = identity(metadata)
    const directory = mkdtempSync(resolve(tmpdir(), 'comms-cli-source-record-'))
    const auth = [
        '-c',
        'http.https://github.com/.extraheader=',
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
    ]
    const git = (args, options = {}) =>
        io.execFileSync('git', [...auth, ...args], { cwd: directory, encoding: 'utf8', ...options })
    const read = (ref) =>
        Object.fromEntries(
            stableSourceRecordAssets.map((name) => [name, git(['show', `${ref}:${name}`])]),
        )
    try {
        git(['init', '--quiet'])
        git(['fetch', '--quiet', '--no-tags', remote, 'refs/heads/main'])
        const tip = git(['rev-parse', 'FETCH_HEAD']).trim()
        git(['merge-base', '--is-ancestor', metadata.sourceSha, tip])
        const matches = git(['log', '--format=%H', '--fixed-strings', `--grep=${marker}`, tip])
            .trim()
            .split('\n')
            .filter(Boolean)
            .filter((sha) => git(['show', '-s', '--format=%B', sha]).split('\n').includes(marker))
        assert.ok(
            matches.length <= 1,
            'Multiple source release records; stop for maintainer inspection',
        )
        const verify = (sha) => {
            assert.match(sha, SHA)
            const parents = git(['rev-list', '--parents', '-n', '1', sha]).trim().split(' ')
            assert.equal(parents.length, 2, 'Source record must have exactly one parent')
            git(['merge-base', '--is-ancestor', metadata.sourceSha, parents[1]])
            assert.equal(
                git(['show', '-s', '--format=%B', sha]).trimEnd(),
                message.trimEnd(),
                'Source record belongs to different original bytes; never replace it',
            )
            const before = read(parents[1])
            const expected = sourceRecordFiles(metadata, before)
            assert.deepEqual(
                read(sha),
                expected,
                'Source record content differs from original release plan',
            )
            const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha])
                .trim()
                .split('\n')
                .filter(Boolean)
                .sort()
            assert.deepEqual(
                paths,
                stableSourceRecordAssets.filter((name) => before[name] !== expected[name]).sort(),
                'Source record changed unrelated files',
            )
            return {
                sourceSha: metadata.sourceSha,
                recordSha: sha,
                version: metadata.version,
                runId: metadata.runId,
                runAttempt: metadata.runAttempt,
                sha256: metadata.sha256,
            }
        }
        if (matches.length) return verify(matches[0])
        assert.equal(
            verifyOnly,
            false,
            `Stable ${metadata.version} source record is incomplete; retry the original publisher before building again`,
        )
        const files = sourceRecordFiles(metadata, read(tip))
        git(['checkout', '--quiet', '--detach', tip])
        for (const name of stableSourceRecordAssets)
            writeFileSync(resolve(directory, name), files[name])
        git(['add', '--', ...stableSourceRecordAssets])
        const messagePath = resolve(directory, '.git', 'release-message')
        writeFileSync(messagePath, message)
        git([
            '-c',
            'user.name=github-actions[bot]',
            '-c',
            'user.email=41898282+github-actions[bot]@users.noreply.github.com',
            'commit',
            '--quiet',
            '--file',
            messagePath,
        ])
        const recordSha = git(['rev-parse', 'HEAD']).trim()
        const record = verify(recordSha)
        git(['push', remote, 'HEAD:refs/heads/main'])
        git(['fetch', '--quiet', '--no-tags', remote, 'refs/heads/main'])
        git(['merge-base', '--is-ancestor', recordSha, 'FETCH_HEAD'])
        return record
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

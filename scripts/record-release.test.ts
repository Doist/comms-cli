import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Run the real record CLI. Only external process boundaries are faked; no remote operations.
function runRecord(overrides: Record<string, unknown>) {
    const directory = mkdtempSync(join(tmpdir(), 'comms-record-cli-'))
    try {
        const bin = join(directory, 'bin')
        mkdirSync(bin)
        const sourceSha = 'a'.repeat(40)
        const metadata = {
            version: '4.1.1',
            sourceSha,
            branch: 'main',
            notes: '[Posted by Jarvis]\n\nNotes',
            filename: 'todoist-comms-cli-4.1.1.tgz',
        }
        const release = {
            id: 42,
            tag_name: 'v4.1.1',
            target_commitish: sourceSha,
            draft: false,
            prerelease: false,
            published_at: '2026-11-10T00:00:00Z',
            body: metadata.notes,
            assets: [],
            ...overrides,
        }
        writeFileSync(join(directory, 'release.json'), JSON.stringify(metadata))
        writeFileSync(join(directory, metadata.filename), 'original-tarball')
        const executable = (name: string, code: string) =>
            writeFileSync(join(bin, name), `#!${process.execPath}\n${code}\n`, { mode: 0o755 })
        executable(
            'node',
            `const args=process.argv.slice(2); if(args[1]==='check-registry') console.log(JSON.stringify({tags:{latest:'4.1.1'}})); else if(args[1]!=='verify') process.exit(91)`,
        )
        executable(
            'git',
            `const args=process.argv.slice(2); if(args.includes('show')) console.log('{"channels":[null]}'); else if(!args.includes('ls-remote')&&!args.includes('fetch')) process.exit(92)`,
        )
        executable(
            'gh',
            `const args=process.argv.slice(2); const route=args.find(x=>x.startsWith('repos/')); if(args.includes('POST')||args.includes('PATCH')||args.includes('DELETE')) {console.error('unexpected write'); process.exit(93)}; if(route?.includes('git/matching-refs')) console.log(JSON.stringify([{ref:'refs/tags/v4.1.1',object:{type:'commit',sha:'${sourceSha}'}}])); else if(route?.includes('/assets')) console.log('[]'); else if(route?.startsWith('repos/todoist/comms-cli/releases?')) console.log(JSON.stringify([${JSON.stringify(release)}])); else if(route==='repos/todoist/comms-cli/releases/42') console.log(JSON.stringify(${JSON.stringify(release)})); else if(route?.includes('/assets')) console.log('[]'); else process.exit(94)`,
        )
        return spawnSync(process.execPath, [resolve('scripts/record-release.mjs'), directory], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: bin,
                GITHUB_REPOSITORY: 'todoist/comms-cli',
                RELEASE_TAG: 'latest',
                GITHUB_OUTPUT: join(directory, 'output'),
            },
        })
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

describe('record CLI does not accept tag name alone', () => {
    it.each([
        ['wrong prerelease', { prerelease: true }, 'Release prerelease state is wrong'],
        [
            'no published timestamp',
            { published_at: null },
            'Release has no valid published timestamp',
        ],
        ['missing original assets', {}, 'lacks todoist-comms-cli-4.1.1.tgz'],
    ])('rejects a same-tag published record with %s', (_label, change, error) => {
        const result = runRecord(change as Record<string, unknown>)
        expect(result.status, result.stderr).not.toBe(0)
        expect(result.stderr).toContain(error)
        expect(result.stderr).not.toContain('unexpected write')
    })
})

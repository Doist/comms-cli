import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'

function required<T>(value: T | undefined): T {
    assert.ok(value)
    return value
}
import { assertRecordedBaseline, completeReleaseRecord } from './github-release-record.mjs'

// GitHub API is the boundary. Persist its state across failures/retries as GitHub does.
function fixture() {
    const metadata = {
        name: '@todoist/comms-cli',
        version: '4.1.1',
        sourceSha: 'a'.repeat(40),
        branch: 'main',
        notes: '[Posted by Jarvis]\n\nOriginal notes',
        filename: 'todoist-comms-cli-4.1.1.tgz',
        runId: '123',
        runAttempt: '2',
        sha256: 'f75a2e8a5a6cb4e64169f570ada8d4916aa4f0b684b2a39894a46a9bfe2d7264',
        integrity:
            'sha512-Wn368XR7iqmcszTtKatnSwBwtbCBki8nnx6HwsOnEKCNhUSlh/6zh3j61jXh1OFwlUjhASA7mrEHx4+WcgRrpg==',
    }
    const files = [
        {
            name: metadata.filename,
            path: '/original/package.tgz',
            bytes: Buffer.from('original-tarball'),
        },
        {
            name: 'release.json',
            path: '/original/release.json',
            bytes: Buffer.from(JSON.stringify(metadata)),
        },
    ]
    const original = {
        id: 42,
        tag_name: 'v4.1.1',
        target_commitish: metadata.sourceSha,
        body: metadata.notes,
        draft: true,
        prerelease: false,
        published_at: null as string | null,
    }
    const state = {
        release: { ...original } as typeof original | undefined,
        tag: metadata.sourceSha as string | undefined,
        assets: [] as { id: number; name: string; size: number; state: string; bytes: Buffer }[],
        writes: [] as unknown[],
        loseResponse: '',
        failedPublish: false,
        sourceRun: {
            id: 123,
            run_attempt: 2,
            repository: { full_name: 'todoist/comms-cli' },
            head_repository: { full_name: 'todoist/comms-cli' },
            workflow_id: 7,
            path: '.github/workflows/release.yml',
            status: 'completed',
            conclusion: 'success',
            event: 'push',
            head_branch: 'main',
            head_sha: metadata.sourceSha,
        },
    }
    const lose = (operation: string) => {
        if (state.loseResponse === operation) {
            state.loseResponse = ''
            throw new Error(`lost ${operation} response`)
        }
    }
    const add = (name: string, bytes: Buffer) => {
        state.assets.push({
            id: 100 + state.assets.length,
            name,
            bytes,
            size: bytes.length,
            state: 'uploaded',
        })
    }
    const api = {
        list: () => (state.release ? [{ id: 42, tag_name: 'v4.1.1' }] : []),
        get: (id: number) => {
            expect(id).toBe(42)
            return { ...state.release }
        },
        assets: (id: number) => {
            expect(id).toBe(42)
            return state.assets
        },
        readAsset: (id: number) => required(state.assets.find((asset) => asset.id === id)).bytes,
        tagSha: (tag: string) => {
            expect(tag).toMatch(/^v4\.1\.[01]$/)
            return state.tag
        },
        createTag: (tag: string, sha: string) => {
            state.writes.push(['tag', tag, sha])
            state.tag = sha
            lose('tag')
        },
        createDraft: (plan: typeof metadata) => {
            state.writes.push(['draft', plan])
            state.release = { ...original }
            lose('draft')
            return { id: 42 }
        },
        upload: (id: number, name: string, path: string) => {
            state.writes.push(['upload', id, name, path])
            add(name, required(files.find((file) => file.path === path)).bytes)
            lose('upload')
        },
        publish: (id: number, plan: typeof metadata) => {
            state.writes.push(['publish', id, plan])
            if (!state.failedPublish) {
                required(state.release).draft = false
                required(state.release).published_at = '2026-11-10T21:00:00Z'
            }
            lose('publish')
        },
        sourceRun: (id: string, attempt: string) => {
            expect([id, attempt]).toEqual(['123', '2'])
            return state.sourceRun
        },
        workflowId: () => 7,
        sourceRecord: (plan: typeof metadata) => {
            expect(plan).toEqual(metadata)
            return { recordSha: 'c'.repeat(40) }
        },
        compare: () => ({ status: 'ahead', merge_base_commit: { sha: metadata.sourceSha } }),
    }
    const populate = () => {
        for (const file of files) add(file.name, file.bytes)
    }
    const published = () => {
        required(state.release).draft = false
        required(state.release).published_at = '2026-11-10T21:00:00Z'
        populate()
    }
    const record = () => completeReleaseRecord(api, metadata, files)
    const baseline = () => assertRecordedBaseline(api, 'v4.1.1')
    return { metadata, files, state, api, populate, published, record, baseline }
}

describe('release record recovery', () => {
    it('skips only a published record with exact original assets and metadata', () => {
        const f = fixture()
        f.published()
        expect(f.record()).toBe(false)
        expect(f.state.writes).toEqual([])
    })
    it('resumes the same draft, keeps uploaded original bytes, and publishes after both assets exist', () => {
        const f = fixture()
        f.populate()
        f.state.assets.pop()
        expect(f.record()).toBe(true)
        expect(f.state.writes).toEqual([
            ['upload', 42, 'release.json', '/original/release.json'],
            ['publish', 42, f.metadata],
        ])
        expect(f.state.release).toMatchObject({
            id: 42,
            draft: false,
            prerelease: false,
            published_at: '2026-11-10T21:00:00Z',
        })
        expect(f.state.assets.map((asset) => [asset.name, asset.bytes])).toEqual(
            f.files.map((file) => [file.name, file.bytes]),
        )
    })
    it.each(['tag', 'draft', 'upload', 'publish'])(
        'recovers a lost %s response without recreation, duplication or retagging',
        (operation) => {
            const f = fixture()
            f.state.release = undefined
            f.state.tag = undefined
            f.state.loseResponse = operation
            expect(f.record).toThrow(`lost ${operation} response`)
            expect(f.record()).toBe(operation !== 'publish')
            expect(f.state.writes).toEqual([
                ['tag', 'v4.1.1', f.metadata.sourceSha],
                ['draft', f.metadata],
                ['upload', 42, 'todoist-comms-cli-4.1.1.tgz', '/original/package.tgz'],
                ['upload', 42, 'release.json', '/original/release.json'],
                ['publish', 42, f.metadata],
            ])
            expect(f.record()).toBe(false)
        },
    )
    it.each([
        'wrong commit',
        'missing tag',
        'wrong target',
        'wrong prerelease',
        'wrong notes',
        'bad draft timestamp',
        'incomplete asset',
        'different bytes',
        'different metadata',
        'duplicate asset',
        'unexpected asset',
    ])('stops before any write on %s', (scenario) => {
        const f = fixture()
        f.populate()
        if (scenario === 'unexpected asset')
            f.state.assets.push({ ...f.state.assets[0], name: 'unreviewed.txt' })
        if (scenario === 'wrong commit') f.state.tag = 'b'.repeat(40)
        if (scenario === 'missing tag') f.state.tag = undefined
        if (scenario === 'wrong target') required(f.state.release).target_commitish = 'b'.repeat(40)
        if (scenario === 'wrong prerelease') required(f.state.release).prerelease = true
        if (scenario === 'wrong notes') required(f.state.release).body += ' edited'
        if (scenario === 'bad draft timestamp')
            required(f.state.release).published_at = '2026-11-10T21:00:00Z'
        if (scenario === 'incomplete asset') f.state.assets[0].state = 'starter'
        if (scenario === 'different bytes') f.state.assets[0].bytes = Buffer.from('different-bytes')
        if (scenario === 'different metadata')
            f.state.assets[1].bytes = Buffer.from(
                f.state.assets[1].bytes.toString().replace('Original', 'Replaced'),
            )
        if (scenario === 'duplicate asset') f.state.assets.push({ ...f.state.assets[0] })
        expect(f.record).toThrow()
        expect(f.state.writes).toEqual([])
    })
    it('checks every existing asset before uploading an earlier missing asset', () => {
        const f = fixture()
        f.populate()
        f.state.assets.shift()
        f.state.assets[0].bytes = Buffer.from('conflict')
        expect(f.record).toThrow(/differs/)
        expect(f.state.writes).toEqual([])
    })
    it('does not report success if the publish response did not finish publication', () => {
        const f = fixture()
        f.populate()
        f.state.failedPublish = true
        expect(f.record).toThrow(/still a draft/)
    })
    it('stops on an incomplete published record with exact original-run recovery guidance', () => {
        const f = fixture()
        f.published()
        f.state.assets.pop()
        expect(f.record).toThrow(
            /Recover original run 123\/2 bytes into this same record; never rebuild, delete, recreate or retag/,
        )
        expect(f.state.writes).toEqual([])
    })
})

describe('recorded semantic-release baseline', () => {
    it('does not accept a stable baseline whose source changelog/version record is still pending', async () => {
        const f = fixture()
        f.published()
        f.api.sourceRecord = () => {
            throw new Error('source record incomplete')
        }
        await expect(f.baseline()).rejects.toThrow('source record incomplete')
        expect(f.state.writes).toEqual([])
    })

    it('accepts durable original assets after Actions artifact expiry', async () => {
        const f = fixture()
        f.published()
        await expect(f.baseline()).resolves.toBeUndefined()
        expect(f.state.writes).toEqual([])
    })
    it.each([
        'bare tag',
        'draft',
        'missing metadata',
        'missing tarball',
        'wrong commit',
        'wrong prerelease',
        'changed bytes',
        'unsuccessful run',
    ])('rejects %s as completed history', async (scenario) => {
        const f = fixture()
        f.published()
        if (scenario === 'bare tag') f.state.release = undefined
        if (scenario === 'draft') {
            required(f.state.release).draft = true
            required(f.state.release).published_at = null
        }
        if (scenario === 'missing metadata') f.state.assets.pop()
        if (scenario === 'missing tarball') f.state.assets.shift()
        if (scenario === 'unexpected asset')
            f.state.assets.push({ ...f.state.assets[0], name: 'unreviewed.txt' })
        if (scenario === 'wrong commit') f.state.tag = 'b'.repeat(40)
        if (scenario === 'wrong prerelease') required(f.state.release).prerelease = true
        if (scenario === 'changed bytes') f.state.assets[0].bytes = Buffer.from('forged')
        if (scenario === 'unsuccessful run') f.state.sourceRun.conclusion = 'failure'
        await expect(f.baseline()).rejects.toThrow()
        expect(f.state.writes).toEqual([])
    })
    it('binds the asset-free legacy exception to the inspected v4.1.0 commit and published state', async () => {
        const f = fixture()
        f.state.tag = '7d75593399fb3c4a51aa6dcfa331098ffbfa8b26'
        required(f.state.release).tag_name = 'v4.1.0'
        required(f.state.release).draft = false
        required(f.state.release).published_at = '2026-11-10T17:25:09Z'
        f.api.list = () => [{ id: 42, tag_name: 'v4.1.0' }]
        await expect(assertRecordedBaseline(f.api, 'v4.1.0')).resolves.toBeUndefined()
        f.state.tag = 'b'.repeat(40)
        await expect(assertRecordedBaseline(f.api, 'v4.1.0')).rejects.toThrow()
        expect(f.state.writes).toEqual([])
    })
})

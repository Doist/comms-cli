import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { retainedPlans } from './pending-release.mjs'

it.each(['success', 'failure'])(
    'uses the original attempt after the latest rerun failed (%s original)',
    async (conclusion) => {
        const directory = mkdtempSync(join(tmpdir(), 'pending-release-'))
        const sha = 'a'.repeat(40)
        const original = {
            id: 42,
            run_attempt: 2,
            repository: { full_name: 'todoist/comms-cli' },
            head_repository: { full_name: 'todoist/comms-cli' },
            workflow_id: 7,
            path: '.github/workflows/release.yml',
            status: 'completed',
            conclusion,
            event: 'push',
            head_branch: 'main',
            head_sha: sha,
        }
        const requests: string[] = []
        const downloads: unknown[] = []
        const request = (route: string) => {
            requests.push(route)
            if (route === 'actions/workflows/release.yml') return { id: 7 }
            if (route === 'actions/workflows/release.yml/runs?branch=main&per_page=100&page=1')
                return {
                    workflow_runs: [
                        { id: 42, run_attempt: 3, conclusion: 'failure', head_sha: sha },
                    ],
                }
            if (route === 'actions/runs/42/artifacts?per_page=100&page=1')
                return { artifacts: [{ id: 11, name: 'release-42-2', expired: false }] }
            if (route === 'actions/runs/42/attempts/2') return original
            if (route === `compare/${sha}...main`)
                return { status: 'ahead', merge_base_commit: { sha } }
            throw Error(`unexpected request ${route}`)
        }
        const collect = async () => {
            const values = []
            for await (const value of retainedPlans('main', directory, {
                request,
                download: (run: unknown) => downloads.push(run),
            }))
                values.push(value)
            return values
        }
        try {
            if (conclusion === 'success') {
                expect(await collect()).toEqual([{ target: join(directory, '42-2'), original }])
                expect(downloads).toEqual([original])
            } else {
                await expect(collect()).rejects.toThrow()
                expect(downloads).toEqual([])
            }
            expect(requests).toContain('actions/runs/42/attempts/2')
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    },
)

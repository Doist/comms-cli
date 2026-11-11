import { describe, expect, it } from 'vitest'
import { githubPages } from './github-pages.mjs'
import { findRelease } from './github-release-record.mjs'

describe('GitHub history reads', () => {
    it('finds a draft on a later page without one unbounded subprocess response', () => {
        const routes: string[] = []
        const release = { id: 42, tag_name: 'v4.1.1', draft: true }
        const api = {
            list: () =>
                githubPages('releases', undefined, (route: string) => {
                    routes.push(route)
                    return route.endsWith('page=1')
                        ? Array.from({ length: 100 }, (_, id) => ({ id, tag_name: `v0.0.${id}` }))
                        : [release]
                }),
            get: (id: number) => {
                expect(id).toBe(42)
                return release
            },
        }
        expect(findRelease(api, 'v4.1.1')).toEqual(release)
        expect(routes).toEqual(['releases?per_page=100&page=1', 'releases?per_page=100&page=2'])
    })
    it('reads workflow result envelopes with their existing filters intact', () => {
        const routes: string[] = []
        const runs = [
            ...githubPages(
                'actions/workflows/release.yml/runs?branch=main&status=success',
                'workflow_runs',
                (route: string) => {
                    routes.push(route)
                    return { workflow_runs: [{ id: 123 }] }
                },
            ),
        ]
        expect(runs).toEqual([{ id: 123 }])
        expect(routes).toEqual([
            'actions/workflows/release.yml/runs?branch=main&status=success&per_page=100&page=1',
        ])
    })
    it('never treats an unread later page as release absence', () => {
        const api = {
            list: () =>
                githubPages('releases', undefined, (route: string) => {
                    if (route.endsWith('page=1'))
                        return Array.from({ length: 100 }, (_, id) => ({
                            id,
                            tag_name: `v0.0.${id}`,
                        }))
                    throw new Error('network failure')
                }),
        }
        expect(() => findRelease(api, 'v4.1.1')).toThrow('network failure')
    })
})

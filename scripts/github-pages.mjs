import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { REPOSITORY } from './release-policy.mjs'

// Bound each gh response instead of collecting the complete history in one child buffer.
// Errors always propagate: an unread page must never imply that a release is absent.
export function* githubPages(
    path,
    key,
    request = (route) =>
        JSON.parse(
            execFileSync('gh', ['api', `repos/${REPOSITORY}/${route}`], {
                encoding: 'utf8',
                maxBuffer: 16 * 1024 * 1024,
            }),
        ),
) {
    for (let page = 1; ; page++) {
        const result = request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
        const items = key ? result[key] : result
        assert.ok(Array.isArray(items), 'Unexpected GitHub pagination response; stop')
        yield* items
        if (items.length < 100) return
    }
}

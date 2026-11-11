import { describe, expect, it } from 'vitest'
import { requireRecordedPlans, requireUnallocatedVersion } from './pending-release.mjs'
import { analyzeCommits } from './release-analysis.mjs'

const context = (version: string, message: string, branch = 'main') => ({
    lastRelease: { version },
    branch: { name: branch },
    commits: [{ hash: 'a'.repeat(40), message }],
    cwd: process.cwd(),
    logger: { log: () => {} },
})

describe('release lineage', () => {
    it('selects the agreed first patch on the existing scope-independent baseline', async () => {
        await expect(analyzeCommits({}, context('4.1.0', 'chore: migrate scope'))).resolves.toBe(
            'patch',
        )
    })
    it('continues normal conventional commit analysis after the first release', async () => {
        await expect(analyzeCommits({}, context('4.1.1', 'fix: repair pagination'))).resolves.toBe(
            'patch',
        )
        await expect(analyzeCommits({}, context('4.1.1', 'feat: add endpoint'))).resolves.toBe(
            'minor',
        )
        await expect(analyzeCommits({}, context('4.1.1', 'chore: update docs'))).resolves.toBeNull()
    })
    it('stops rather than resetting history or squeezing a feature into the first patch', async () => {
        await expect(analyzeCommits({}, context('', 'chore: migrate scope'))).rejects.toThrow()
        await expect(analyzeCommits({}, context('4.1.0', 'feat: new endpoint'))).rejects.toThrow()
        await expect(analyzeCommits({}, context('4.1.0', 'fix: repair', 'next'))).rejects.toThrow()
    })
    it('rejects an already-tagged prerelease even when its channel note is still missing', () => {
        // Without the next channel note, semantic-release can propose this version again.
        expect(() =>
            requireUnallocatedVersion('4.2.0-next.1', (tag: string) => tag === 'v4.2.0-next.1'),
        ).toThrow(/already tagged/)
        expect(() =>
            requireUnallocatedVersion('4.2.0-next.2', (tag: string) => tag === 'v4.2.0-next.1'),
        ).not.toThrow()
    })
    it('holds later builds until a pending artifact is recorded', () => {
        const plans = [{ version: '4.1.1', runId: '42' }]
        expect(() => requireRecordedPlans(plans, () => false)).toThrow(
            /Finish that exact artifact first/,
        )
        expect(() =>
            requireRecordedPlans(
                plans,
                (plan: { version: string; runId: string }) =>
                    plan.version === '4.1.1' && plan.runId === '42',
            ),
        ).not.toThrow()
    })
})

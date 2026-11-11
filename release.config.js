// The former stable-only changelog/git prepare hooks are completed by record-release.mjs
// AFTER exact-artifact dual publication. Build analysis must never commit these files.
export const stableSourceRecordAssets = [
    'CHANGELOG.md',
    'package.json',
    'package-lock.json',
    'skills/comms-cli/SKILL.md',
]

/** @type {import('semantic-release').GlobalConfig} */
export default {
    branches: ['main', { name: 'next', prerelease: true }],
    // Scope-independent history: v4.1.0 remains the baseline for the first new-scope 4.1.1.
    tagFormat: 'v${version}',
    // Analysis only. The separate publisher records tags/releases after BOTH registries match.
    dryRun: true,
    plugins: ['./scripts/release-analysis.mjs'],
}

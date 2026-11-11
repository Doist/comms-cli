import assert from 'node:assert/strict'
import { analyzeCommits as analyze } from '@semantic-release/commit-analyzer'
import { generateNotes as notes } from '@semantic-release/release-notes-generator'

export async function analyzeCommits(config, context) {
    const type = await analyze({ ...config, preset: 'conventionalcommits' }, context)
    // Tags remain v<version> across the rename. Never reinterpret old tags as unpublished 1.0.0.
    assert.ok(context.lastRelease.version, 'Existing v<version> release history is required')
    if (context.lastRelease.version === '4.1.0') {
        assert.equal(
            context.branch.name,
            'main',
            'Publish stable 4.1.1 before starting new-scope next',
        )
        assert.ok(
            !type || type === 'patch',
            'New feature/breaking commits require target reconciliation',
        )
        return 'patch' // explicitly approved first real @todoist/comms-cli artifact
    }
    return type
}

export async function generateNotes(config, context) {
    const body = await notes({ ...config, preset: 'conventionalcommits' }, context)
    return `[Posted by Jarvis]\n\n${body}`
}

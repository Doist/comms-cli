import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { registryJson, validatePublicationTag } from './release-policy.mjs'

export function publishArtifact(
    { metadata, tarball, destination, command, tag },
    io = { execFileSync, spawnSync },
    environment = process.env,
) {
    assert.ok(['npmjs', 'github'].includes(destination))
    assert.ok(
        environment.GH_PACKAGES_TOKEN,
        'GH_PACKAGES_TOKEN with read:packages is required to preflight BOTH registries',
    )
    const isolated = mkdtempSync(resolve(tmpdir(), 'comms-cli-publish-'))
    try {
        const registries = {
            npmjs: 'https://registry.npmjs.org/',
            github: 'https://npm.pkg.github.com/',
        }
        const options = {}
        for (const [name, registry] of Object.entries(registries)) {
            // Each destination has its own config and credentials; npm never receives a GitHub token.
            const env = Object.fromEntries(
                Object.entries(environment).filter(
                    ([key]) =>
                        !/^npm_config_/i.test(key) &&
                        ![
                            'NODE_AUTH_TOKEN',
                            'NPM_TOKEN',
                            'GH_TOKEN',
                            'GITHUB_TOKEN',
                            'GH_PACKAGES_TOKEN',
                            'SOURCE_GH_TOKEN',
                        ].includes(key),
                ),
            )
            const userconfig = resolve(isolated, `${name}.npmrc`)
            const globalconfig = resolve(isolated, 'global.npmrc')
            const auth =
                name === 'github' ? '//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}\n' : ''
            if (name === 'github') env.GH_PACKAGES_TOKEN = environment.GH_PACKAGES_TOKEN
            writeFileSync(
                userconfig,
                `registry=${registry}\n@todoist:registry=${registry}\n${auth}`,
                { mode: 0o600 },
            )
            writeFileSync(globalconfig, '')
            Object.assign(env, {
                NPM_CONFIG_USERCONFIG: userconfig,
                NPM_CONFIG_GLOBALCONFIG: globalconfig,
                NPM_CONFIG_CACHE: resolve(isolated, `${name}-cache`),
            })
            options[name] = { cwd: isolated, env }
            for (const key of ['registry', '@todoist:registry']) {
                assert.equal(
                    io
                        .execFileSync('npm', ['config', 'get', key], {
                            ...options[name],
                            encoding: 'utf8',
                        })
                        .trim(),
                    registry,
                )
            }
        }
        const spec = `${metadata.name}@${metadata.version}`
        const view = (name, target, field) =>
            registryJson(
                io.spawnSync(
                    'npm',
                    [
                        'view',
                        target,
                        field,
                        '--prefer-online',
                        '--json',
                        `--registry=${registries[name]}`,
                    ],
                    { ...options[name], encoding: 'utf8' },
                ),
            )
        const requireGitHubAbsenceAccess = () => {
            // Package-level readability makes a version-level 404 meaningful. An ACL-filtered
            // package 404 is otherwise ambiguous, even with valid registry login or list[].
            const packageName = view('github', metadata.name, 'name')
            if (packageName !== undefined) {
                assert.equal(packageName, metadata.name, 'Unexpected GitHub package metadata')
                const registryTags = view('github', metadata.name, 'dist-tags')
                assert.ok(
                    registryTags &&
                        typeof registryTags === 'object' &&
                        !Array.isArray(registryTags) &&
                        Object.values(registryTags).every((version) => typeof version === 'string'),
                    'GitHub registry root/dist-tags must be readable with the same token',
                )
                return
            }
            const response = io.execFileSync(
                'gh',
                ['api', '--hostname', 'github.com', '--include', 'user/memberships/orgs/todoist'],
                {
                    encoding: 'utf8',
                    env: { ...environment, GH_TOKEN: environment.GH_PACKAGES_TOKEN },
                },
            )
            const separator = /\r?\n\r?\n/.exec(response)
            assert.ok(separator, 'Cannot verify GitHub organization owner response')
            const headers = response.slice(0, separator.index)
            assert.match(headers, /^HTTP\/\S+ 200\b/)
            const scopes = (headers.match(/^x-oauth-scopes:[ \t]*([^\r\n]*)/im)?.[1] || '')
                .split(',')
                .map((scope) => scope.trim())
            assert.ok(
                scopes.some((scope) => ['read:packages', 'write:packages'].includes(scope)),
                'Owner absence proof requires a classic PAT with read:packages',
            )
            const membership = JSON.parse(response.slice(separator.index + separator[0].length))
            assert.equal(membership.organization?.login?.toLowerCase(), 'todoist')
            assert.equal(
                membership.state,
                'active',
                'GitHub package is unreadable; active org-owner proof required',
            )
            assert.equal(
                membership.role,
                'admin',
                'GitHub package is unreadable; organization-owner proof required',
            )
        }
        const preflightBoth = () => {
            const copies = {}
            for (const name of Object.keys(registries)) {
                copies[name] = view(name, spec, 'dist.integrity')
                if (copies[name] !== undefined)
                    assert.equal(
                        copies[name],
                        metadata.integrity,
                        `Different same-version bytes on ${name}; no write permitted`,
                    )
                else if (name === 'github') requireGitHubAbsenceAccess()
            }
            return copies
        }
        const tags = (name) => {
            const value = view(name, metadata.name, 'dist-tags') ?? {}
            assert.ok(
                value && typeof value === 'object' && !Array.isArray(value),
                'Invalid registry tags',
            )
            return value
        }
        let copies = preflightBoth()
        if (copies[destination] !== undefined)
            return { status: 'already-matches', tags: tags(destination) }
        assert.notEqual(command, 'check-registry', `Missing ${destination} mirror`)
        if (command === 'bootstrap-npm') {
            assert.notEqual(
                environment.GITHUB_ACTIONS,
                'true',
                'Bootstrap needs an interactive maintainer',
            )
            io.execFileSync('npm', ['login', '--auth-type=web', `--registry=${registries.npmjs}`], {
                ...options.npmjs,
                stdio: 'inherit',
            })
        }
        const previousTags = tags(destination)
        validatePublicationTag(metadata.version, tag, previousTags)
        // Repeat immediately before EVERY registry write, including after interactive login.
        copies = preflightBoth()
        if (copies[destination] !== undefined)
            return { status: 'already-matches', tags: tags(destination) }
        const args = [
            'publish',
            tarball,
            '--ignore-scripts',
            `--tag=${tag}`,
            `--registry=${registries[destination]}`,
            '--provenance=false',
        ]
        if (destination === 'npmjs') args.push('--access=public')
        // GitHub visibility is independently administered; never send --access there.
        // Both login and publish can prompt for browser auth/2FA.
        io.execFileSync('npm', args, { ...options[destination], stdio: 'inherit' })
        copies = preflightBoth()
        assert.equal(
            copies[destination],
            metadata.integrity,
            'Publication may have succeeded; inspect before retrying',
        )
        const currentTags = tags(destination)
        assert.equal(currentTags[tag], metadata.version)
        for (const channel of ['latest', 'next']) {
            if (tag !== channel)
                assert.equal(
                    currentTags[channel],
                    previousTags[channel],
                    `${channel} changed during recovery`,
                )
        }
        return { status: 'published', tags: currentTags }
    } finally {
        rmSync(isolated, { recursive: true, force: true })
    }
}

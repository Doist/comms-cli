import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { publishArtifact } from './registry-release.mjs'

const metadata = { name: '@todoist/comms-cli', version: '4.1.1', integrity: 'sha512-reviewed' }
const environment = {
    GH_PACKAGES_TOKEN: 'fixture-gh',
    GH_TOKEN: 'fixture-api',
    SOURCE_GH_TOKEN: 'fixture-read',
    NODE_AUTH_TOKEN: 'fixture-old',
    NPM_CONFIG_REGISTRY: 'https://wrong.invalid',
}
function fixture(
    copies: Record<string, unknown> = {},
    access: {
        tagsUnreadable?: boolean
        readable: boolean
        role: string
        state: string
        scopes: string
        loseAfterLogin?: boolean
        ownerError?: boolean
    } = { readable: true, role: 'member', state: 'active', scopes: 'read:org, read:packages' },
) {
    const events: { args: string[]; options: any }[] = []
    let ghReads = 0
    const io = {
        execFileSync(bin: string, args: string[], options: any) {
            events.push({ args, options })
            if (bin === 'gh') {
                if (access.ownerError) throw new Error('owner proof unavailable')
                expect(args).toEqual([
                    'api',
                    '--hostname',
                    'github.com',
                    '--include',
                    'user/memberships/orgs/todoist',
                ])
                expect(options.env.GH_TOKEN).toBe('fixture-gh')
                return `HTTP/2.0 200 OK\r\nx-oauth-scopes: ${access.scopes}\r\n\r\n${JSON.stringify({ role: access.role, state: access.state, organization: { login: 'todoist' } })}`
            }
            if (args[0] === 'config')
                return readFileSync(options.env.NPM_CONFIG_USERCONFIG, 'utf8')
                    .split('\n')
                    .find((line) => line.startsWith(`${args[2]}=`))
                    ?.slice(args[2].length + 1)
            if (args[0] === 'login' && access.loseAfterLogin) {
                access.readable = false
                access.state = 'pending'
            }
            if (args[0] === 'publish')
                copies[args.some((x) => x.includes('npm.pkg.github.com')) ? 'github' : 'npmjs'] =
                    metadata.integrity
            return ''
        },
        spawnSync(_bin: string, args: string[], options: any) {
            events.push({ args, options })
            const destination = args.some((x) => x.includes('npm.pkg.github.com'))
                ? 'github'
                : 'npmjs'
            if (args[2] === 'name')
                return access.readable
                    ? { status: 0, stdout: JSON.stringify('@todoist/comms-cli') }
                    : { status: 1, stdout: '{"error":{"code":"E404"}}' }
            if (args[2] === 'dist-tags' && destination === 'github' && access.tagsUnreadable)
                return { status: 1, stdout: '{"error":{"code":"E404"}}' }
            if (args[2] === 'dist-tags')
                return {
                    status: 0,
                    stdout: JSON.stringify({
                        latest: copies[destination] === metadata.integrity ? '4.1.1' : '4.1.0',
                    }),
                }
            if (destination === 'github') ghReads++
            const value = copies[destination]
            if (value === 'E401') return { status: 1, stdout: '{"error":{"code":"E401"}}' }
            if (value === 'late-conflict' && ghReads > 1)
                return { status: 0, stdout: '"sha512-conflict"' }
            return value === undefined || value === 'late-conflict'
                ? { status: 1, stdout: '{"error":{"code":"E404"}}' }
                : { status: 0, stdout: JSON.stringify(value) }
        },
    }
    const execute = (command = 'publish', destination = 'npmjs') =>
        publishArtifact(
            { metadata, tarball: '/fixture/reviewed.tgz', destination, command, tag: 'latest' },
            io,
            environment,
        )
    return { execute, events }
}

describe('same artifact dual registry publication', () => {
    it.each(['publish', 'bootstrap-npm'])(
        'rejects an ACL-hidden GitHub package before %s despite a nonempty token',
        (command) => {
            const f = fixture(
                {},
                {
                    readable: false,
                    role: 'member',
                    state: 'active',
                    scopes: 'read:org, read:packages',
                },
            )
            expect(() => f.execute(command)).toThrow(/owner|readable/i)
            expect(f.events.filter((e) => ['publish', 'login'].includes(e.args[0]))).toEqual([])
        },
    )
    it('does not let an already-matching selected mirror hide an unreadable opposite package', () => {
        const f = fixture(
            { npmjs: metadata.integrity },
            { readable: false, role: 'member', state: 'active', scopes: 'read:org, read:packages' },
        )
        expect(() => f.execute()).toThrow(/owner|readable/i)
    })

    it('permits a version 404 only when the same credential can read the package', () => {
        const f = fixture({})
        expect(f.execute().status).toBe('published')
        expect(f.events.some((e) => e.args[0] === 'api')).toBe(false)
    })
    it('allows initial absence only with active owner and package-read proof from the same token', () => {
        const f = fixture(
            {},
            { readable: false, role: 'admin', state: 'active', scopes: 'read:org, read:packages' },
        )
        expect(f.execute().status).toBe('published')
        expect(f.events.filter((e) => e.args[0] === 'api')).toHaveLength(3)
    })
    it.each([
        { readable: false, role: 'admin', state: 'pending', scopes: 'read:org, read:packages' },
        { readable: false, role: 'admin', state: 'active', scopes: 'read:org' },
    ])('rejects insufficient owner access %j before any write', (access) => {
        const f = fixture({}, access)
        expect(() => f.execute()).toThrow()
        expect(f.events.filter((e) => ['publish', 'login'].includes(e.args[0]))).toEqual([])
    })

    it('rechecks read access after interactive login before publication', () => {
        const f = fixture(
            {},
            {
                readable: true,
                role: 'admin',
                state: 'active',
                scopes: 'read:org, read:packages',
                loseAfterLogin: true,
            },
        )
        expect(() => f.execute('bootstrap-npm')).toThrow(/owner/)
        expect(f.events.some((e) => e.args[0] === 'login')).toBe(true)
        expect(f.events.some((e) => e.args[0] === 'publish')).toBe(false)
    })
    it('stops when owner proof has an auth or network failure', () => {
        const f = fixture(
            {},
            {
                readable: false,
                role: 'admin',
                state: 'active',
                scopes: 'read:org, read:packages',
                ownerError: true,
            },
        )
        expect(() => f.execute()).toThrow('owner proof unavailable')
        expect(f.events.filter((e) => ['publish', 'login'].includes(e.args[0]))).toEqual([])
    })

    it.each(['sha512-conflict', 'E401'])(
        'stops before any write when the other mirror returns %s',
        (github) => {
            const f = fixture({ github })
            expect(() => f.execute()).toThrow()
            expect(f.events.filter((e) => ['publish', 'login'].includes(e.args[0]))).toEqual([])
        },
    )
    it('checks the other mirror even when the selected destination already matches', () => {
        const f = fixture({ npmjs: metadata.integrity, github: 'sha512-conflict' })
        expect(() => f.execute()).toThrow()
    })
    it('skips identical copies and only writes the missing destination', () => {
        const both = fixture({ npmjs: metadata.integrity, github: metadata.integrity })
        expect(both.execute().status).toBe('already-matches')
        expect(both.events.some((e) => e.args[0] === 'publish')).toBe(false)
        const missing = fixture({ github: metadata.integrity })
        expect(missing.execute().status).toBe('published')
        const writes = missing.events.filter((e) => e.args[0] === 'publish')
        expect(writes.map((e) => e.args)).toEqual([
            [
                'publish',
                '/fixture/reviewed.tgz',
                '--ignore-scripts',
                '--tag=latest',
                '--registry=https://registry.npmjs.org/',
                '--provenance=false',
                '--access=public',
            ],
        ])
    })
    it('preflights again after interactive login and before publish', () => {
        const f = fixture({ github: 'late-conflict' })
        expect(() => f.execute('bootstrap-npm')).toThrow()
        expect(f.events.some((e) => e.args[0] === 'login')).toBe(true)
        expect(f.events.some((e) => e.args[0] === 'publish')).toBe(false)
    })
    it('lets login and publish prompt for 2FA without exposing GitHub credentials to npm', () => {
        const f = fixture()
        f.execute('bootstrap-npm')
        for (const event of f.events.filter((e) => ['login', 'publish'].includes(e.args[0]))) {
            expect(event.options.stdio).toBe('inherit')
            expect(event.options.env.GH_PACKAGES_TOKEN).toBeUndefined()
            expect(event.options.env.GH_TOKEN).toBeUndefined()
            expect(event.options.env.SOURCE_GH_TOKEN).toBeUndefined()
            expect(event.options.env.NODE_AUTH_TOKEN).toBeUndefined()
            expect(event.options.env.NPM_CONFIG_REGISTRY).toBeUndefined()
        }
    })
})

it('rejects a name-only response when registry dist-tags are unreadable', () => {
    const f = fixture(
        {},
        {
            readable: true,
            tagsUnreadable: true,
            role: 'member',
            state: 'active',
            scopes: 'read:packages',
        },
    )
    expect(() => f.execute()).toThrow(/registry|readable/i)
    expect(f.events.filter((e) => ['publish', 'login'].includes(e.args[0]))).toEqual([])
})

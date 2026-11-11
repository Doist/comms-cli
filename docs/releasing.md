# Releasing Comms CLI after Migration 001

This draft is **WAITING_FOR_PUBLICATION**, not mergeable. It prepares public
`@todoist/comms-cli`; `tdc`, config paths, keyring service, OAuth client ID,
product domains and API version remain unchanged. No migration publication has
happened. The original lockfile is deliberately unchanged until real upstream
releases exist; do not replace its integrity or URLs by hand.

## Dependencies and release lineage

Current main, `v4.1.0` and npm `@doist/comms-cli@latest` agree on 4.1.0. The
first proposed new-scope version is **4.1.1**. `release.config.js` retains the
scope-independent `v${version}` tags and semantic-release Conventional Commits.
Missing history, a different first baseline, or an intervening feature/breaking
change requires target reconciliation. Following releases use normal analysis,
including `next.N` and the `next` npm channel. Existing releases/tags are untouched.

The CLI consumes intended `@todoist/comms-sdk@4.0.1` ([SDK draft #139](https://github.com/Doist/comms-sdk-typescript/pull/139)),
which requires intended `@todoist/sdk-kmp@0.6.2` ([KMP draft #74](https://github.com/Doist/sdk-kmp/pull/74)).
Neither was available on npm at preparation. GitHub registry 404s did not establish
absence or package readability. Require both real copies and actual consumer access.

`cli-core` is outside this repository's write scope. Its current main/npm release
is **@doist/cli-core 1.10.0**; no new-scope release or migration PR was found.
Henning routes the existing owner to prepare and publish the current-forward
`@todoist/cli-core` successor to both registries with the same artifact/version.
The temporary manifest constraint `~1.10.0` expresses the compatible current line,
**not a claimed new-scope version**. Replace it with the owner's exact real version
before merge. Preserve the root, `auth`, `commands`, `markdown`, and `testing`
exports, token store/OAuth/config contracts, updater channels, and `cli-agent`
header contract. Reconcile any changed API before finalization; do not invent a
successor version or backport an old line.

SDK 4 requires a workspace ID when uploading attachments. Each CLI upload uses
the already resolved destination channel/thread/conversation workspace. Dry-run,
read-only guards, path validation and command syntax stay intact. The core 1.10
usage-header addition is exercised with a fixed agent fixture.

## Finalize this draft after upstream publication

Use the actual owner-selected `CLI_CORE_VERSION`; the registry must contain it.
The following commands have **not** been run against new-scope packages:

```sh
npm view @todoist/comms-sdk@4.0.1 version dependencies dist --registry=https://registry.npmjs.org/ --json
npm view @todoist/sdk-kmp@0.6.2 version dist --registry=https://registry.npmjs.org/ --json
npm view "@todoist/cli-core@$CLI_CORE_VERSION" version exports dist --registry=https://registry.npmjs.org/ --json
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --save-exact \
  "@todoist/cli-core@$CLI_CORE_VERSION" @todoist/comms-sdk@4.0.1
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
```

Review the genuine lock identities, URLs, integrity and transitive KMP version;
repeat fresh review and update this same draft. No aliases or local paths belong
in the committed dependency tree. Installs during preparation use `--ignore-scripts`:
`prepare` resets shared Git hooks, and `postinstall` updates user-installed skills.
Only `npm run sync:skill` regenerates this repository's standalone skill; never run
global skill/update/completion commands as a check.

## Operator setup and merge prerequisites

Merge wave: **M04 dependent CLI producer**, after SDK/KMP and cli-core publication;
TodoistOS [#616](https://github.com/Doist/todoist-os/pull/616) activates in M05 after
this CLI is published and installed successfully from both required registries.
A merged draft or tag alone does not satisfy either consumer gate.

Existing package/GitHub owners, routed through Henning, must complete:

1. Rename/access/M01 activation. The existing bootstrap action is
   `todoist/comms-actions/post-comment-action@aeeefe3270ad30d0c4cdd7dbf94b2fac1dcb8ceb`.
   Do not gate this publisher on unpublished-dependency consumers actions#243 or
   comms-actions#7, or invent their eventual bundle pins.
2. Resolve the **OAuth continuity gate**. The immutable client ID is
   `https://raw.githubusercontent.com/Doist/comms-cli/main/oauth/client-metadata.json`.
   The OAuth server fetches exactly that URL, requires the document's matching
   `client_id`, and does not follow redirects. The existing auth owner must verify
   that exact identity still works after rename or arrange an approved compatible
   server transition before cutover. Changing the ID in this PR would invalidate
   existing credentials. Preserve the old logo URL and every shipped icon path too.
3. [Create the protected npm-release environment](https://github.com/todoist/comms-cli/settings/environments),
   with maintainer approval and default-branch publisher execution. None existed
   during preparation. Preserve existing release App secret names and approved
   contents-write permissions; do not bypass branch rules for source commitback.
4. [Confirm GitHub package settings](https://github.com/orgs/todoist/packages/npm/package/comms-cli):
   intended visibility independently of npm's public visibility, repository link,
   publisher Write, and only actual GitHub-routed consumers' Read grants.
   Local read/write credentials need package scopes, repository access and required
   organization SSO. A package inventory or whoami is not readability evidence.
5. First publish the real retained artifact interactively as below. Only after the
   npm identity exists, near the next release, configure
   [npm trusted publishing](https://www.npmjs.com/package/@todoist/comms-cli/access):
   owner `todoist`, repository `comms-cli`, workflow **publish-release.yml**,
   environment **npm-release**, direct npm publish. No reusable caller.
   GitHub-hosted ubuntu-latest, Node 24, npm >=11.5.1, id-token:write.
   Manual publication does not validate OIDC. Configure close to use (new unused
   connections expire after two days); separately authorize dist-tag management.
6. Set `COMMS_CLI_AUTOMATIC_RELEASES=true` only after bootstrap, package ACLs and
   publisher setup have been verified. Until then, automatic publication is off.

After these gates and review, Henning may approve and merge the draft normally.
Do not use admin/bypass, force, auto-merge or a ready transition during preparation.
A future authorized merge command is:

```sh
gh pr merge "$CLI_PR_URL" --repo todoist/comms-cli --squash --match-head-commit "$REVIEWED_HEAD"
```

## Build once, publish the retained artifact

`release.yml` on main/next builds, verifies, analyzes and packs; it writes no tag,
release, source commit or registry. Manual builds are restricted to main/next.
Artifacts are retained 90 days under `release-RUN-ATTEMPT`. The workflow's
contents:write permission is used for semantic-release's dry-run authorization
probe. Feature branch pushes and draft PRs cannot enter this path.

`publish-release.yml` is a separate protected main-branch workflow. Automatic
workflow_run publication requires the explicit variable above and a successful
push build. Manual builds never auto-publish. Publication is serialized across
channels and retries. The normal Comms announcement remains attached only to a
new completed stable release; its existing service identities and destination
are unchanged. Recovery and next do not announce.

Future operator commands, **not performed during preparation**:

```sh
gh workflow run release.yml --repo todoist/comms-cli --ref main
gh run list --repo todoist/comms-cli --workflow release.yml --limit 10 \
  --json databaseId,headSha,headBranch,event,conclusion
```

Select the actual successful original `ARTIFACT_RUN_ID`, `ARTIFACT_RUN_ATTEMPT`,
full reviewed `RELEASE_SHA` and a new absolute `RELEASE_DIR`. Do not substitute a
later rerun: source validation uses the original attempts endpoint. The helper
binds the unique artifact ID, authenticated API ZIP digest, metadata and tarball
entry bytes. A local checksum or self-declared JSON file is insufficient.

Obtain `GH_PACKAGES_TOKEN` through the existing secure credential flow, never in
source or shell history. For a first unreadable GitHub mirror, use an authorized
active organization-owner classic PAT with read:org and read:packages (also
write:packages for its first upload), including required SSO. The same token must
prove owner access or read the actual registry package name **and dist-tags**.
Metadata REST/whoami/list[] alone cannot establish absence. `gh` source artifact
read authentication is separate from the package token.

```sh
export ARTIFACT_RUN_ID ARTIFACT_RUN_ATTEMPT RELEASE_SHA GH_PACKAGES_TOKEN
gh run download "$ARTIFACT_RUN_ID" --repo todoist/comms-cli \
  --name "release-$ARTIFACT_RUN_ID-$ARTIFACT_RUN_ATTEMPT" --dir "$RELEASE_DIR"
node scripts/release.mjs verify "$RELEASE_DIR"
node scripts/release.mjs bootstrap-npm "$RELEASE_DIR"
node scripts/release.mjs publish "$RELEASE_DIR" github
# After mirror visibility/linkage/ACLs are correct, skip matching copies and record:
gh workflow run publish-release.yml --repo todoist/comms-cli --ref main \
  -f artifact_run_id="$ARTIFACT_RUN_ID" -f artifact_run_attempt="$ARTIFACT_RUN_ATTEMPT" \
  -f source_sha="$RELEASE_SHA" -f destination=github -f tag=normal
```

Both login and publish inherit terminal input for fresh 2FA. Each destination has
an isolated registry/scope mapping, config and cache; global npm settings are
unchanged. npm receives public access and no GitHub credentials. GitHub visibility
is administered separately. The tarball preserves `tdc`, runtime dependencies and
skill postinstall, removes release/development scripts and routing overrides,
and uses `--ignore-scripts --provenance=false` for upload. A later publisher run
must not attest that it built an earlier source artifact.

Before **every registry write**, including npm-only bootstrap or GitHub-only
retry, preflight any existing same-version copies in **both** registries against
the retained integrity. Stop on mismatch, auth/network failure or ambiguous
absence. Repeat after interactive login. Matching copies skip; there is no
independent version bump, rebuild or overwrite for a missing mirror.

For later trusted releases or partial retry use the same dispatch command with
`destination=both`, `npmjs` or `github` as appropriate. Every path still checks
both copies. A pending original artifact blocks another build for its version,
including when a later failed rerun changes the run's latest status.

## Record and recover

Only after both registry bytes and normal latest/next channels match does the
publisher record the scope-independent tag at the original build SHA and create
an attributed release. It validates published timestamp, draft/prerelease state,
source/tag identity and **all existing assets before uploading anything**. A
matching interrupted draft resumes with the same release ID and original bytes;
conflicting/incomplete assets stop for owner reconciliation. It never deletes,
recreates, retargets or force-moves an old tag/release.

Stable source bookkeeping updates only CHANGELOG.md, root package/lock versions,
and the existing skill metadata version. It preserves intervening main changes,
records a separate source-record SHA in semantic-release notes and reuses an
already-completed record after a lost push response. The generated commit body
contains identity trailers, never copied breaking-change release notes. Full
notes stay in CHANGELOG/GitHub. `next` excludes stable source commitback; its
channel note still advances normal prereleases. A normal non-force push detects
concurrent changes; retry the original publisher after resolving the race.

A recorded release is complete only when its assets, tag, channels and stable
source record all validate. If latest/next has advanced, use explicit
`tag=migration-recovery` (or `RELEASE_TAG=migration-recovery` locally). It fills
an older missing mirror without moving normal channels or recording/announcing.
The existing owner handles temporary-tag cleanup only after byte verification:

```sh
npm dist-tag rm @todoist/comms-cli migration-recovery \
  --registry=https://registry.npmjs.org/ --@todoist:registry=https://registry.npmjs.org/
npm dist-tag rm @todoist/comms-cli migration-recovery \
  --registry=https://npm.pkg.github.com/ --@todoist:registry=https://npm.pkg.github.com/
```

Use isolated destination credentials/config; interactive auth unless separately
configured OIDC tag permission and a supported CLI (npm >=11.21 on v11 or >=12.2
on v12). Expired original Actions artifacts or unsupported metadata stop for an
explicitly reviewed original-byte recovery procedure, never repacking an
immutable published version. Workflow maintenance alone does not invalidate
an original successful source run.

## Consumer handoff

TodoistOS #616 needs this producer PR, final version, `tdc` bin, identical
npmjs/GitHub tarballs, actual registry access and installation evidence. The
prepared candidate is 4.1.1; update consumers if normal release analysis changes
it. New CLI self-update reads `@todoist/comms-cli` with latest for stable and next
for prereleases. An already-installed old-scope CLI cannot discover the new
package by itself: the operator/setup must explicitly migrate that installation,
retaining its config and credentials. No global installation was run here.

In an isolated consumer test prefix after real publication, repeat for each
registry with its actual routing/authentication (lifecycle-disabled for the
initial package/bin smoke check):

```sh
npm install --prefix "$CONSUMER_PREFIX" --ignore-scripts --no-audit --no-fund \
  @todoist/comms-cli@4.1.1 --registry=https://registry.npmjs.org/ \
  --@todoist:registry=https://registry.npmjs.org/
"$CONSUMER_PREFIX/node_modules/.bin/tdc" --version
"$CONSUMER_PREFIX/node_modules/.bin/tdc" update --help
```

Repeat using `https://npm.pkg.github.com/` and the intended consumer credential;
compare both downloaded tarballs to the retained SHA/integrity. Then the owner
can resume TodoistOS's existing controlled setup/update process. Keep its package
channel policy and `tdc` executable; do not edit TodoistOS from this repository.

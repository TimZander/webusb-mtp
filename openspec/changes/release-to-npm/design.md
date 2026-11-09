## Context

See proposal.md. `package.json` already has `files`, `exports` and a `prepublishOnly` script that
runs the type check, the tests and the build. CI (`ci.yml`) runs the same on Node 22. The package
name `webusb-mtp` is free on npm. The repository is public, which npm provenance needs, and
`repository.url` names it. The owner has an npm account and a token, and wants no
command-line step on their own machine.

## Goals / Non-Goals

**Goals:** a release the owner starts from the Actions tab; the first publish with a token, later
ones with trusted publishing and no token; checks before publishing; provenance.

**Non-Goals:** automatic releases on merge or tag, version bumps, changelogs, git tags, GitHub
releases; garmin-mtp's release (it gets the same workflow later).

## Decisions

- **Started by hand (`workflow_dispatch`), publish job guarded by `github.ref == 'refs/heads/main'`.**
  A release is an outward act the owner decides on; a tag trigger would let anyone who can push a
  tag publish, and a merge trigger would publish every merge.
- **Two jobs: check, then publish.** The check job (`contents: read`) runs `npm ci`, the type
  check, the tests and the build, and uploads `dist` as an artifact. The publish job (`id-token:
  write`) checks out, downloads `dist`, and runs `npm publish --access public --provenance
  --ignore-scripts` with the token; it installs no dependencies and runs no project code. In one
  job, every step, dependency install scripts included, could request the OIDC token that trusted
  publishing accepts (conformance review R1), and letting `npm publish` run `prepublishOnly` would
  put the token beside every test and dev dependency (spec review round 1).
- **Trusted publishing first, token as fallback.** npm 11.5.1 and later, in GitHub Actions with
  `id-token: write`, try OIDC first and use `NODE_AUTH_TOKEN` only when no trusted publisher
  matches. The publish job installs `npm@11.21.1` (exact: it is the code that holds the credential;
  released 2026-10-15), sets `registry-url` on
  `setup-node` (which writes the `.npmrc` that reads `NODE_AUTH_TOKEN`), and passes the secret as
  `NODE_AUTH_TOKEN`.
- **Actions pinned to commit SHAs** (`actions/checkout` v4.2.2, `actions/setup-node` v4.4.0,
  `actions/upload-artifact` v4.6.2, `actions/download-artifact` v4.3.0), checkout
  without persisted credentials and no npm cache, since this workflow holds a publishing
  credential; `ci.yml` keeps its tags and cache.
- **An `npm` environment gates the publish job.** Its required reviewer is the owner, and its
  deployment branches are `main` only. The owner creates it in the repository's settings (no tool
  here can); until it exists GitHub creates it on first use with no protection, so it must be set
  up before the first release. npm's trusted publisher names the environment too.
- **Plain versions only.** Prereleases (`1.2.3-beta.1`) aren't in scope; the release publishes to
  `latest`.
- **Kept in this repository, not ci-recipes, for now** (owner asked). A shared workflow would let
  ci-recipes' writers change how the package publishes, and whether npm's trusted publishing
  matches a reusable workflow called from another repository is unverified. Revisit once both
  libraries have released.
- **The workflow is tested by reading it.** A vitest test parses `release.yml` with the `yaml`
  package and checks the trigger, the branch guard, the permissions, the SHA pins and the secret's
  reach. It can't test npm itself; the first real release is that check.

## Risks / Trade-offs

- [OIDC-before-token is from memory: the session couldn't reach npm's docs] → if npm uses the token
  first, the release still works; only the "no change when the secret is deleted" claim depends on
  it, and the owner sees it at the second release.
- [A token that may bypass two-factor authentication sits in the repository's secrets until
  trusted publishing is set up] → short expiry (7 days), deleted after the first publish.
- [Anyone or any app with Actions access can start the release on `main`, the Claude GitHub App
  included] → the publish job waits in the `npm` environment for the owner's approval.

## Open Questions

0. **Does deleting `NPM_TOKEN` need no workflow change?** npm 11.5.1+ tries OIDC before
   `NODE_AUTH_TOKEN` (from memory; npm's docs couldn't be reached), and an empty secret leaves an
   empty token in `.npmrc`. *Assumption:* yes; the second release, run after the token is deleted,
   checks it (task 4.2).

1. **Require an approval before publishing** (a GitHub environment with the owner as reviewer)?
   **Answered (owner, 2026-11-09): yes** (ADR 0013). The code review found that apps with Actions
   access, the Claude GitHub App included, can start the release, so "only the owner can start it"
   was wrong.
2. **Tag the released commit** (`v0.1.0`) from the workflow? *Assumption:* not now; it needs
   `contents: write`, which this change avoids. A later change can add it.
3. **Node version for releases.** *Assumption:* 22, as CI.

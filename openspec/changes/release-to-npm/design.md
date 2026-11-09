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
- **Checks as their own steps; publish with `--ignore-scripts`.** The workflow runs `npm ci`, the
  type check, the tests and the build as separate steps with no secret, then
  `npm publish --access public --provenance --ignore-scripts` with the token. Letting `npm publish`
  run `prepublishOnly` would put the token in the environment of every test and dev dependency;
  skipping it publishes the `dist` the build step just made. (Spec review round 1.)
- **Trusted publishing first, token as fallback.** npm 11.5.1 and later, in GitHub Actions with
  `id-token: write`, try OIDC first and use `NODE_AUTH_TOKEN` only when no trusted publisher
  matches. The workflow installs `npm@^11.5.1`, sets `registry-url` on
  `setup-node` (which writes the `.npmrc` that reads `NODE_AUTH_TOKEN`), and passes the secret as
  `NODE_AUTH_TOKEN`.
- **Actions pinned to commit SHAs** (`actions/checkout` v4.2.2, `actions/setup-node` v4.4.0), checkout
  without persisted credentials and no npm cache, since this workflow holds a publishing
  credential; `ci.yml` keeps its tags and cache.
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
- [Anyone with write access can run the workflow on `main`] → only the owner has write access.

## Open Questions

0. **Does deleting `NPM_TOKEN` need no workflow change?** npm 11.5.1+ tries OIDC before
   `NODE_AUTH_TOKEN` (from memory; npm's docs couldn't be reached), and an empty secret leaves an
   empty token in `.npmrc`. *Assumption:* yes; the second release, run after the token is deleted,
   checks it (task 4.2).

1. **Require an approval before publishing** (a GitHub environment with the owner as reviewer)?
   *Assumption:* no; only the owner can start the workflow, so a second click adds nothing yet.
2. **Tag the released commit** (`v0.1.0`) from the workflow? *Assumption:* not now; it needs
   `contents: write`, which this change avoids. A later change can add it.
3. **Node version for releases.** *Assumption:* 22, as CI.

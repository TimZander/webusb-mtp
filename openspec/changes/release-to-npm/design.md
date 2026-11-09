## Context

See proposal.md. `package.json` already has `files`, `exports` and a `prepublishOnly` script that
runs the type check, the tests and the build. CI (`ci.yml`) runs the same on Node 22. The package
name `webusb-mtp` is free on npm. The owner has an npm account and a token, and wants no
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
- **`npm publish` runs the checks through `prepublishOnly`.** The workflow runs `npm ci`, then
  `npm publish --access public --provenance`; npm runs `prepublishOnly` (type check, tests, build)
  first and publishes nothing when it fails. Separate check steps would only run them twice.
- **Trusted publishing first, token as fallback.** npm 11.5.1 and later, in GitHub Actions with
  `id-token: write`, try OIDC first and use `NODE_AUTH_TOKEN` only when no trusted publisher
  matches. The workflow installs npm 11 and passes the secret as `NODE_AUTH_TOKEN`, so deleting the
  secret later needs no workflow change.
- **Actions pinned to commit SHAs** (`actions/checkout` v4.2.2, `actions/setup-node` v4.4.0), since
  this workflow holds a publishing credential; `ci.yml` keeps its tags.
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

1. **Require an approval before publishing** (a GitHub environment with the owner as reviewer)?
   *Assumption:* no; only the owner can start the workflow, so a second click adds nothing yet.
2. **Tag the released commit** (`v0.1.0`) from the workflow? *Assumption:* not now; it needs
   `contents: write`, which this change avoids. A later change can add it.
3. **Node version for releases.** *Assumption:* 22, as CI.

## Why

The library is ready for npm but has never been published, and the owner wants to release it
without running commands on a laptop. A release started from GitHub, which runs the checks and
publishes with provenance, makes releases repeatable and keeps the npm credential out of every
machine but GitHub's.

## What Changes

- Add a release workflow, started by hand from the Actions tab on the default branch, that
  installs, type-checks, tests, builds and publishes the version in `package.json` to npm,
  publicly and with provenance.
- It authenticates with npm's trusted publishing (GitHub's OIDC) when the package has it set up,
  else with an `NPM_TOKEN` repository secret, so the first publish can use a short-lived token and
  later ones need no token at all.
- A test that reads the workflow file and checks what it may do: the trigger, the branch, the
  permissions, the pinned actions and where the secret reaches.
- A "Releasing" section in the README.

## Capabilities

### New Capabilities

- `npm-release`: how a version of the library gets from the default branch to npm.

### Modified Capabilities

None.

## Impact

- New `.github/workflows/release.yml` and a test of it; a YAML parser as a dev dependency.
- The owner adds the `NPM_TOKEN` secret for the first publish, then trusted publishing on
  npmjs.com, and deletes the token.
- Not in scope: version bumps, changelogs, git tags or GitHub releases, and garmin-mtp's release.

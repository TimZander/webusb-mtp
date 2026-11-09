## Purpose

Publish a version of the library to npm from GitHub, started by the owner, after the same checks
as CI, with provenance and without any credential leaving GitHub.

## ADDED Requirements

### Requirement: A release is started by hand on the default branch
The release workflow SHALL run only when started by hand (`workflow_dispatch`), and its publish
job SHALL run only when started on `main`. No push, pull request, tag or schedule SHALL start it.

#### Scenario: Started on main
- **WHEN** the owner runs the release workflow from the Actions tab on `main`
- **THEN** the publish job runs

#### Scenario: Started on another branch
- **WHEN** the release workflow is run on branch `feature-x`
- **THEN** the publish job is skipped and nothing is published

#### Scenario: Other events
- **WHEN** a commit is pushed, a pull request is opened or a tag is pushed
- **THEN** the release workflow doesn't run

### Requirement: Nothing is published unless the checks pass
Before the publish step, the release SHALL install from the lock file and run the type check, the
tests and the build as steps of their own, and SHALL publish nothing when any of them fails.

#### Scenario: A test fails
- **WHEN** a release is started and one test fails
- **THEN** the workflow fails at the test step and no version is published

### Requirement: The version in package.json is published publicly with provenance
The release SHALL publish the version `package.json` holds, built by the build step, with public
access and an npm provenance statement linking it to the workflow run. It SHALL never force a
publish or unpublish, so a version npm already holds fails the release.

#### Scenario: New version
- **WHEN** `package.json` says `1.2.3`, npm has no `1.2.3`, and the checks pass
- **THEN** `webusb-mtp@1.2.3` is public on npm with a provenance statement for that run

#### Scenario: Version already published
- **WHEN** `package.json` says `1.2.3` and npm already has `1.2.3`
- **THEN** the release fails and npm's `1.2.3` is unchanged

### Requirement: The release authenticates with trusted publishing or the token
The release SHALL publish to `https://registry.npmjs.org` with an npm that supports trusted
publishing (11.5.1 or later), using trusted publishing when the package has this repository's
release workflow as its trusted publisher, and otherwise the `NPM_TOKEN` repository secret.

#### Scenario: First publish
- **WHEN** the package doesn't exist on npm yet and `NPM_TOKEN` holds a token that may publish
- **THEN** the release publishes with that token

#### Scenario: Trusted publishing set up
- **WHEN** the package's trusted publisher is this repository's release workflow
- **THEN** the release publishes through trusted publishing

### Requirement: The release's reach is kept small
The workflow SHALL grant exactly `contents: read` and `id-token: write` at workflow level, with no
job-level grants; pin every action to a full commit SHA; check out without keeping credentials and
use no cache. `NPM_TOKEN` SHALL reach only the publish step, which runs no package scripts.

#### Scenario: Workflow file checked
- **WHEN** the workflow file is read by the repository's tests
- **THEN** its permissions are exactly those two at workflow level and none at job level, every `uses:` names a 40-character SHA, checkout has `persist-credentials: false`, no step caches, and `secrets.NPM_TOKEN` appears only in the publish step, whose command has `--ignore-scripts`

#### Scenario: No step shows the environment
- **WHEN** the workflow file's run commands are read
- **THEN** none runs `env`, `printenv`, `set -x` or echoes a secret

### Requirement: Releasing is documented
The README SHALL install the package from npm, and SHALL say how a release is made: bump the
version in a pull request, merge it, then run the release workflow on `main`; and how the first
publish's token gives way to trusted publishing.

#### Scenario: README read
- **WHEN** someone reads the README
- **THEN** its install step is `npm install webusb-mtp` with no note that it isn't published, and its "Releasing" section names the version bump, the workflow to run on `main`, the `NPM_TOKEN` secret for the first publish, and trusted publishing after it

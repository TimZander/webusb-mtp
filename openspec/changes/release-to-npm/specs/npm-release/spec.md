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
Before publishing, the release SHALL install from the lock file and run the type check, the
tests and the build, and SHALL publish nothing when any of them fails.

#### Scenario: A test fails
- **WHEN** a release is started and one test fails
- **THEN** the workflow fails and no version is published

### Requirement: The version in package.json is published publicly with provenance
The release SHALL publish the version `package.json` holds, with public access and an npm
provenance statement linking it to the workflow run. A version that npm already holds SHALL fail
the release without changing what is published.

#### Scenario: New version
- **WHEN** `package.json` says `0.1.0`, npm has no `0.1.0`, and the checks pass
- **THEN** `webusb-mtp@0.1.0` is public on npm with a provenance statement for that run

#### Scenario: Version already published
- **WHEN** `package.json` says `0.1.0` and npm already has `0.1.0`
- **THEN** the release fails and npm's `0.1.0` is unchanged

### Requirement: The release authenticates without a stored credential where it can
The release SHALL use npm's trusted publishing when the package has this repository's workflow as
its trusted publisher, and otherwise the `NPM_TOKEN` repository secret. It SHALL need no change to
the workflow when the secret is deleted after trusted publishing is set up.

#### Scenario: First publish
- **WHEN** the package doesn't exist on npm yet and `NPM_TOKEN` holds a token that may publish
- **THEN** the release publishes with that token

#### Scenario: Trusted publishing set up
- **WHEN** the package's trusted publisher is this repository's release workflow and `NPM_TOKEN` is deleted
- **THEN** the release still publishes, with no workflow change

### Requirement: The release's reach is kept small
The workflow SHALL grant only `contents: read` and `id-token: write`, SHALL pin every action it
uses to a full commit SHA, and SHALL give the `NPM_TOKEN` secret to the publish step alone. It
SHALL never print the secret.

#### Scenario: Workflow file checked
- **WHEN** the workflow file is read by the repository's tests
- **THEN** its permissions are exactly `contents: read` and `id-token: write`, every `uses:` names a 40-character SHA, and `secrets.NPM_TOKEN` appears only in the publish step's environment

### Requirement: Releasing is documented
The README SHALL say how a release is made: bump the version in a pull request, merge it, then run
the release workflow on `main`; and how the first publish's token gives way to trusted publishing.

#### Scenario: README read
- **WHEN** someone reads the README's "Releasing" section
- **THEN** it names the version bump, the workflow to run on `main`, the `NPM_TOKEN` secret for the first publish, and trusted publishing after it

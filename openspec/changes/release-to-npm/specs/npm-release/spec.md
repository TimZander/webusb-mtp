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

### Requirement: A publish waits for the owner's approval
The publish job SHALL run in the GitHub environment `npm`, whose required reviewer is the owner, so
a started release publishes only after the owner approves it in GitHub. The trusted publisher on
npm SHALL name that environment.

#### Scenario: Release started by someone else
- **WHEN** a collaborator or an app with Actions access starts the release on `main`
- **THEN** the publish job waits for the owner's approval, and nothing is published until the owner approves

#### Scenario: Workflow file checked for the environment
- **WHEN** the workflow file is read by the repository's tests
- **THEN** the publish job's environment is `npm`, and the check job has none

### Requirement: Nothing is published unless the checks pass
A check job SHALL install from the lock file and run the type check, the tests and the build as
steps of their own. The publish job SHALL need the check job, and no job or step SHALL continue on
error or run regardless of an earlier failure, so a failing check publishes nothing.

#### Scenario: A test fails
- **WHEN** a release is started and one test fails
- **THEN** the check job fails at the test step, the publish job doesn't run, and no version is published

#### Scenario: Workflow file checked for failure handling
- **WHEN** the workflow file is read by the repository's tests
- **THEN** the publish job needs the check job, and no job or step has `continue-on-error` or an `if:` with `always()`, `failure()` or `cancelled()`

### Requirement: The version in package.json is published publicly with provenance
The release SHALL publish the version `package.json` holds, built by the check job's build, with public
access and an npm provenance statement linking it to the workflow run. It SHALL never force a
publish or unpublish, so a version npm already holds fails the release.

#### Scenario: New version
- **WHEN** `package.json` says `1.2.3`, npm has no `1.2.3`, and the checks pass
- **THEN** `webusb-mtp@1.2.3` is public on npm with a provenance statement for that run

#### Scenario: Version already published
- **WHEN** `package.json` says `1.2.3` and npm already has `1.2.3`
- **THEN** the release fails and npm's `1.2.3` is unchanged

### Requirement: The release authenticates with trusted publishing or the token
The release SHALL publish to `https://registry.npmjs.org` with an exact npm version that supports
trusted publishing (11.5.1 or later), using trusted publishing when the package has this repository's
release workflow as its trusted publisher, and otherwise the `NPM_TOKEN` repository secret.

#### Scenario: First publish
- **WHEN** the package doesn't exist on npm yet and `NPM_TOKEN` holds a token that may publish
- **THEN** the release publishes with that token

#### Scenario: Trusted publishing set up
- **WHEN** the package's trusted publisher is this repository's release workflow
- **THEN** the release publishes through trusted publishing

### Requirement: The release's reach is kept small
The workflow SHALL grant `contents: read` only, and the publish job alone `id-token: write`. The
publish job SHALL run no project code: it takes the check job's build, and its only commands are
installing the exact npm and publishing. Every action SHALL be pinned to a full commit SHA, checkouts keep no credentials, nothing is
cached, and `NPM_TOKEN` reaches only the publish step, which runs no package scripts.

#### Scenario: Workflow file checked
- **WHEN** the workflow file is read by the repository's tests
- **THEN** the workflow grants `contents: read`, the check job adds nothing, the publish job grants `contents: read` and `id-token: write`, every `uses:` names a 40-character SHA, checkouts have `persist-credentials: false`, no step caches, and the publish job's run commands are exactly the npm install and the publish

#### Scenario: Secrets reach only the publish step
- **WHEN** the workflow file is read by the repository's tests
- **THEN** the only `secrets` expression in it is `secrets.NPM_TOKEN` in the publish step's `env`, no workflow-level or job-level `env` exists, and the publish command has `--ignore-scripts`

#### Scenario: No step shows the environment
- **WHEN** the workflow file's run commands are read
- **THEN** none runs `env`, `printenv`, `set -x` or echoes a secret

### Requirement: Releases run one at a time
A release SHALL wait for one already running to finish rather than run beside it or cancel it, and
each job SHALL stop after 15 minutes. GitHub keeps one waiting release: a third start replaces
the one waiting, never the one running.

#### Scenario: Started twice
- **WHEN** the owner starts a release while another is running
- **THEN** the second waits until the first has finished

### Requirement: Releasing is documented
The README SHALL install the package from npm, and SHALL say how a release is made: bump the
version in a pull request, merge it, run the release workflow on `main` and approve it; and how the first
publish's token gives way to trusted publishing.

#### Scenario: README read
- **WHEN** someone reads the README
- **THEN** its install step is `npm install webusb-mtp` with no note that it isn't published, and its "Releasing" section names the version bump, the workflow to run on `main`, the approval in the `npm` environment, the `NPM_TOKEN` secret for the first publish, and trusted publishing after it

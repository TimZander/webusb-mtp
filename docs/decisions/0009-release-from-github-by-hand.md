---
status: accepted
date: 2026-11-09
decision-makers: the owner (no command line on a laptop); Claude (the trigger)
---
# Releases are started by hand from GitHub, on `main`

## Context and Problem Statement

The library had never been published. The owner asked to publish it without running commands on
their own machine. How should a release get from the repository to npm?

## Considered Options

- Publish from the owner's laptop (`npm login`, `npm publish`).
- A GitHub workflow started on every push of a version tag.
- A GitHub workflow started on every merge to `main` that bumps the version.
- A GitHub workflow started by hand (`workflow_dispatch`), publishing from `main` only.

## Decision Outcome

Chosen option: "started by hand, from `main` only", because a release is an outward act the owner
decides on, and it needs nothing on a laptop. A tag trigger lets anyone who can push a tag publish;
a merge trigger publishes every merge and needs version-bump automation. The version comes from
`package.json`, bumped in a pull request.

### Consequences

- Good, because the owner releases from the Actions tab, also from a phone.
- Good, because what is published is what `main` holds, after the checks.
- Bad, because the version bump and the release are two steps; forgetting the bump fails the run
  (npm refuses an existing version), which is harmless.

## More Information

Spec: `npm-release` › "A release is started by hand on the default branch". Open questions 1–3 of
`release-to-npm`'s design (approval gate, git tag, Node version) went ahead on their assumptions.

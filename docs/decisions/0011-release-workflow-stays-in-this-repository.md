---
status: proposed
date: 2026-11-09
decision-makers: Claude (recommendation); the owner asked, not yet answered
---
# The release workflow stays in this repository, not in ci-recipes, for now

## Context and Problem Statement

The owner keeps shared workflows in `TimZander/ci-recipes` and asked whether the npm publish
workflow belongs there. `garmin-mtp` will need the same release.

## Considered Options

- A reusable workflow in ci-recipes, called by both libraries.
- A workflow in each repository, moved to ci-recipes later.

## Decision Outcome

Chosen option: "a workflow in each repository, for now", because the publishing workflow is the
one place a credential lives: a shared one lets ci-recipes' writers change how both packages
publish, and whether npm's trusted publishing matches a reusable workflow called from another
repository is unverified (npm's docs couldn't be reached from the session). ci-recipes today holds
Cloudflare Pages workflows, and moving a repository onto it is the owner's call.

### Consequences

- Good, because each package's trusted publisher names a workflow in its own repository.
- Bad, because garmin-mtp gets a copy, and the two can drift until they are shared.

## More Information

Revisit once both libraries have released, starting with checking trusted publishing against a
reusable workflow. Status is `proposed` until the owner agrees.

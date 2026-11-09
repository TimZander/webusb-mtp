---
status: accepted
date: 2026-11-09
decision-makers: the owner (answer to open question 1 of release-to-npm)
---
# A publish waits for the owner's approval in the `npm` environment

## Context and Problem Statement

The design assumed only the owner could start the release, so an approval would add nothing. A code
review of PR #4 found that anyone or any app with Actions access can dispatch it, the Claude GitHub
App included, whose sessions have a workflow-dispatch tool. Should a started release publish at once?

## Considered Options

- Publish at once (the first assumption).
- Run the publish job in a GitHub environment, `npm`, with the owner as required reviewer and
  `main` as its only deployment branch, and name it in npm's trusted publisher.

## Decision Outcome

Chosen option: "the `npm` environment", because the owner chose it: publishing becomes an act only
the owner completes, whoever starts the run. Naming the environment in the trusted publisher makes
npm refuse an OIDC token from any run that didn't pass the gate.

### Consequences

- Good, because a Claude session or a collaborator can prepare and start a release, but can't
  publish it.
- Bad, because each release needs a second step (Approve, also from the GitHub app), and the
  environment must be created by hand before the first release: without it GitHub creates an
  unprotected one on first use.

## More Information

Spec: `npm-release` › "A publish waits for the owner's approval". Replaces the assumption under
open question 1 that ADR 0009 went ahead on; ADR 0009's trigger decision stands.

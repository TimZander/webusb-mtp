---
status: accepted
date: 2026-11-09
decision-makers: Claude
---
# How `release-to-npm` was reviewed

## Context and Problem Statement

A workflow that publishes with a credential is high-risk under the sdd rules: it gets a security
review and an attack test besides the spec and conformance reviews. What did each find?

## Considered Options

- Stop after the first conformance review's fixes.
- Run a second conformance round after the fixes, and an attack test of the final workflow.

## Decision Outcome

Chosen option: "a second round and an attack test", because round 1 changed the job layout.

- Spec review, 1 round: no blocker, 7 should-fixes (token beside the tests, `registry-url`,
  npm 11.5.1, an unverifiable SHALL moved to an open question, an owner task for the second release).
- Conformance review round 1: 3 hard fails. The spec itself allowed the OIDC exposure (R1), and two
  tests missed `continue-on-error`/`always()` and `secrets['…']` (shown by mutation). Fixed through
  the spec, then failing tests, then code.
- Security review: no finding at confidence 8 or more; R1 rated hardening.
- Conformance review round 2: 4 soft gaps, fixed.
- Attack test: 14 edits an attacker would make to the workflow, each failing the tests.

### Consequences

- Good, because the riskiest flaw was found before any release ran.
- Bad, because npm's own behaviour (OIDC before the token, the 11.5.1 floor) rests on memory until
  the second release (task 4.2).

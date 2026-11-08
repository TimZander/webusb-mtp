---
status: accepted
date: 2026-11-08
decision-makers: Claude (lane)
---
# How `lift-mtp-core` was split, reviewed and stopped

## Context and Problem Statement

The repository started empty, and this session's pushes were refused for a while, so the setup and
the change had to be ordered without a merged base.

## Considered Options

- One PR with sdd setup and the change together.
- The sdd setup in its own PR (`claude/sdd-init`), and the change on `claude/lift-mtp-core`, stacked
  on it, opened once the setup merges.

## Decision Outcome

Chosen option: "Stacked", because the workflow says sdd setup is merged on its own and a change's PR
carries only its spec, code and ADRs. The spec review ran its 3 allowed rounds (blockers: progress
timing claimed for reads in round 1; a contradiction between "broken pipe" and "no data" in round 2;
none in round 3) and was stopped there. The conformance review ran twice: round 1 found one bug
(see 0005) and test gaps; round 2 found no hard failures, and its three soft gaps were closed.

### Consequences

- Good, because each PR is reviewable on its own.
- Bad, because the change's PR can't target `main` until the setup PR merges.

## More Information

Assumptions the change rested on are the open questions in its `design.md`.

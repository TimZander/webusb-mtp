---
status: accepted
date: 2026-11-25
decision-makers: the owner
---
# Update sdd from 0.3.3 to 0.4.4

## Context and Problem Statement

The repository pinned sdd 0.3.3. The owner asked for every sdd repository to move to the plugin's
current version, 0.4.4. sdd archive verify before 0.4.3 fails an archive commit, and 0.4.4 brings
spec review's pass I questions. Should this repository update now, and how?

## Considered Options

- Update now with `/sdd:init`, one code-free PR.
- Stay on 0.3.3 until the next change needs it.

## Decision Outcome

Chosen option: "update now", because the owner asked for it and the next archive here would
otherwise fail verification on 0.3.3.

What the update did: refreshed the plugin-owned `scripts/sdd/*` (added `sdd-azure.mjs` and
`sdd-azure-pr.sh`, unused on GitHub), `.claude/sdd-workflow.md` and `.claude/sdd-version`.
`sdd-init` printed no warnings. Deletion check: every line removed from `.claude/sdd-workflow.md`
is plugin text that 0.4.4 rewords (the GitHub/Azure DevOps split of the check-verdict rules); no
repository-added rule was lost. `npm install` rewrote `package-lock.json` without `libc` fields
(a different npm than ADR 0007's npm 11), so that change was reverted and the lock file is
untouched.

### Consequences

- Good, because archives verify under the current scripts and spec review gets pass I.
- Good, because the check of this PR passes locally: `check-specs.sh` success, typecheck and 120 tests pass.
- Bad, because CI checks this PR with the old default-branch scripts until it merges.

## More Information

Lesson: running `npm install` in sdd-init can churn the lock file when the local npm isn't 11;
check `git diff package-lock.json` and revert noise (ADR 0007).

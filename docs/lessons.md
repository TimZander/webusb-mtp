# Lessons

What surprised us or went wrong, and what to do differently. Newest first.

## 2026-11-08 — A pipe into `tail` hid a failed check (lift-mtp-core)

`bash scripts/sdd/check-specs.sh --worktree | tail -1 && git commit …` committed a spec that failed
strict validation (a requirement over 500 characters): the pipeline's exit status is `tail`'s, not
the check's. The bad commit was caught one step later and squashed before anything was pushed.
**Do instead:** never gate a commit on a piped command; run the check alone, or use
`set -o pipefail`.

## 2026-11-08 — Testing a constant doesn't test the default (lift-mtp-core)

The lifted tests checked `OPERATION_TIMEOUT_MS === 10_000`, and the suite still passed with the
session's real defaults set to a few milliseconds. The conformance review's mutation probe found
it. **Do instead:** test a default through the object that uses it (fake timers: still pending
just before the limit, rejected at it).

## 2026-11-08 — A characterization spec overreaches easily (lift-mtp-core)

Writing a spec for existing code, the first draft said "a data phase times out only when it stalls"
— true for writes, false for reads, which get one total limit. It read naturally and contradicted
the code. The spec review caught it by reading the code beside the spec. **Do instead:** when
specifying code that exists, write each SHALL with the code open, and name the case it covers
(writes, reads, both) rather than the general noun.

## 2026-11-08 — npm 10 crashed on vitest 4's peers (lift-mtp-core)

`npm install` crashed in the resolver (`reading 'edgesOut'`) even for an empty project with only
vitest; `--legacy-peer-deps` produced a lock that `npm ci` then refused. npm 11 wrote a lock that npm
10's `npm ci` accepts (ADR 0007). **Do instead:** when npm's resolver crashes, try a newer npm for
the lock before loosening peer rules, and verify with a clean `npm ci` under the CI's npm.

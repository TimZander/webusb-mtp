# Lessons

What surprised us or went wrong, and what to do differently. Newest first.

## 2026-11-09 — npm showed `0.0.0-stage` before the real version (first release)

The release run published `webusb-mtp@0.1.0` (the log said `+ webusb-mtp@0.1.0`, with provenance),
yet for a minute or two `npm view webusb-mtp` returned `0.0.0-stage` as `latest`. npm had said "Your
package is being processed and may take a few minutes to become available", and the placeholder
stays in the package's `time` history. 0.1.0 then appeared as `latest`, with the integrity value
from the publish log. **Do instead:** after a publish, don't read the first `npm view` as the
result: poll with `--prefer-online` until the version from the publish log is `latest`, and check
its `dist.integrity` against the log before building anything on it.

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

## 2026-11-09 — "Token only in the publish step" missed the OIDC token (release-to-npm)

The spec kept `NPM_TOKEN` to one step and passed spec review, yet granted `id-token: write` to the
whole job, so every step, install scripts included, could request the credential trusted publishing
accepts. The conformance review found it by asking what each step could reach, not what the file
said. **Do instead:** for a workflow that publishes, list every credential a step can obtain
(secrets, `GITHUB_TOKEN`, OIDC) per job, and keep jobs that run dependency code free of all of them.

## 2026-11-09 — Regex checks of a workflow file miss other spellings (release-to-npm)

A test looked for `secrets.NPM_TOKEN` outside the publish step; `secrets['NPM_TOKEN']` and
`toJSON(secrets)` got past it, as did `continue-on-error` and `if: always()` past a step-order test.
**Do instead:** test a workflow against what it may contain (count every `secrets` mention, allowlist
a sensitive job's commands), and try the attacker's edits against the tests before trusting them.

## 2026-11-09 — "Only the owner can start it" forgot the apps (release-to-npm)

The design waved off an approval gate because only the owner has write access. Apps count too: the
Claude GitHub App can dispatch workflows, so any session with its tools could start a release. A
fresh code review caught it; the spec and conformance reviews had accepted the claim. **Do
instead:** for an outward action, list who and what can trigger it (people, apps, bots, other
workflows) before deciding it needs no gate, and prefer a gate the owner alone can pass.


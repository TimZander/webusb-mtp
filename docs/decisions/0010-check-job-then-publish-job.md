---
status: accepted
date: 2026-11-09
decision-makers: Claude (from the conformance and security reviews of release-to-npm)
---
# A check job without credentials, then a publish job that runs no project code

## Context and Problem Statement

Publishing needs a credential: first an npm token (`NPM_TOKEN`), later npm's trusted publishing,
where any step holding `id-token: write` can request the OIDC token npm accepts. The checks run
`npm ci`, the tests and the build, which execute every dev dependency's code. Where may the
credential be?

## Considered Options

- One job, `npm publish` running `prepublishOnly` (the checks) with the token set (first draft).
- One job, checks as separate steps, `id-token: write` for the whole job, token only on the
  publish step (round 1 code).
- Two jobs: `check` (`contents: read`) builds and uploads `dist`; `publish` (`id-token: write`)
  downloads it and only installs an exact npm and publishes with `--ignore-scripts`.

## Decision Outcome

Chosen option: "two jobs", because it is the only one where no dependency's code runs beside a
publishing credential. The first option gave the token to every test and dev dependency (spec
review); the second let every step, install scripts included, request the OIDC token once trusted
publishing is on (conformance review R1; the security review rated it hardening, 3/10, since it needs a
compromised dependency first). npm itself is pinned exactly (`11.21.1`), since it is the code that
holds the credential; actions are pinned to commit SHAs.

### Consequences

- Good, because a compromised dev dependency can't publish the package.
- Good, because the tests check the layout and refuse 14 attack edits to the workflow (task 3.2).
- Bad, because the build crosses jobs as an artifact (kept one day), and npm's pin needs bumping
  by hand.

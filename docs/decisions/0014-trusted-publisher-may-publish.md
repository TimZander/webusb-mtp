---
status: accepted
date: 2026-11-09
decision-makers: the owner
---
# The trusted publisher may publish, not only stage

## Context and Problem Statement

After the npm token was deleted, the 0.1.1 release used trusted publishing for the first time, and
npm refused it: `403 Forbidden - PUT https://registry.npmjs.org/webusb-mtp - OIDC permission denied for
this action`. The trusted publisher on npmjs.com matched the repository, `release.yml` and the
`npm` environment, but its permission was "npm stage publish". The workflow publishes directly
(`npm publish`), which that permission doesn't allow. npm recommends staging. Which should the
release use?

## Considered Options

- Keep "stage publish" (npm's recommendation), and change the workflow to stage the release so that
  a second approval on npmjs.com completes it.
- Grant the trusted publisher full "publish", and keep the workflow as it is.

## Decision Outcome

Chosen option: "full publish", because the owner chose it. Every release already waits for the
owner's approval in the GitHub `npm` environment (ADR 0013), so an approval on npmjs.com as well would
add a second manual step without a different person behind it. The workflow stays unchanged.

### Consequences

- Good, because a release is one approval, and the workflow and its tests stay as they are.
- Good, because it answers open question 0 of `release-to-npm`: with the token deleted, the
  release authenticates through trusted publishing alone. An empty `NODE_AUTH_TOKEN` didn't get
  in the way, so that env line can stay.
- Bad, because the trusted publisher can now publish without a step on npmjs.com, which is wider
  than npm recommends. A publish still needs a run on `main` and the owner's approval in the
  `npm` environment.

## More Information

0.1.1 was published by re-running the failed publish job after the change, with provenance (SLSA
v1). Its integrity on npm matches the publish log.

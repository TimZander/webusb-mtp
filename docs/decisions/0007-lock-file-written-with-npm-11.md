---
status: accepted
date: 2026-11-08
decision-makers: Claude (lane)
---
# The lock file is written with npm 11

## Context and Problem Statement

`npm install` with Node 22's npm 10.9 crashed while resolving vitest 4's peer dependencies
(`Cannot read properties of null (reading 'edgesOut')`), even in an empty project with vitest
alone. `--legacy-peer-deps` wrote a lock that a plain `npm ci` rejected.

## Considered Options

- Commit an `.npmrc` with `legacy-peer-deps=true`.
- Pin an older vitest.
- Write the lock with npm 11 (`npx npm@11 install`), and keep CI on Node 22's own npm.

## Decision Outcome

Chosen option: "Write the lock with npm 11", because its lock passed a clean `npm ci` under npm
10 locally, so CI needs nothing special and the dependencies stay current.

### Consequences

- Good, because there is no global npm setting to remember.
- Bad, because a future `npm install` with npm 10 may hit the crash again; use `npx npm@11 install`.

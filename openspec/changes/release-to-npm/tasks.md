## 1. Tests first

- [ ] 1.1 Add `yaml` as a dev dependency and `test/releaseWorkflow.test.ts`: manual trigger only, publish job guarded to `main`, workflow-level permissions exactly `contents: read` + `id-token: write` and none per job, every action pinned to a SHA, `persist-credentials: false`, no cache, `registry-url` set, `npm ci`, type check, tests and build as steps before `npm publish --access public --provenance --ignore-scripts`, `NPM_TOKEN` only in that step as `NODE_AUTH_TOKEN`, `npm@^11.5.1` installed, Node 22, no `env`/`printenv`/`set -x`/`--force`/`unpublish`
- [ ] 1.2 A test that the README installs with `npm install webusb-mtp` with no "not published" note, and that its "Releasing" section names the version bump, the workflow, `NPM_TOKEN` and trusted publishing
- [ ] 1.3 See them fail before the workflow and README exist

## 2. Workflow and README

- [ ] 2.1 `.github/workflows/release.yml`
- [ ] 2.2 README: "Releasing" section; drop the "Not published yet" note
- [ ] 2.3 Tests, type check and build pass

## 3. Review and records

- [ ] 3.1 Conformance review (round 1: R1 two jobs, M1 failure handling, M2 secret expressions, R2 exact npm, S1 one at a time, R3 lock churn)
- [ ] 3.2 `/security-review` of the diff and an attack test (the workflow handles a secret)
- [ ] 3.3 ADRs and lessons

## 4. Owner, after merge

- [ ] 4.1 Run the release on `main`; set up trusted publishing for `webusb-mtp` on npmjs.com; delete the token and the `NPM_TOKEN` secret
- [ ] 4.2 The next release, with no secret, publishes through trusted publishing (open question 0)

## 1. Tests first

- [x] 1.1 Add `yaml` as a dev dependency and `test/releaseWorkflow.test.ts`: manual trigger only, publish job guarded to `main`, a check job (install, type check, tests, build, upload `dist`) and a publish job that needs it, `contents: read` for the workflow and `id-token: write` for the publish job alone, the publish job's only commands an exact npm (≥ 11.5.1) and `npm publish --access public --provenance --ignore-scripts`, nothing that ignores a failure, every action pinned to a SHA, `persist-credentials: false`, no cache, `registry-url` set, `NPM_TOKEN` only in the publish step as `NODE_AUTH_TOKEN`, one release at a time, 15-minute jobs, Node 22, no `env`/`printenv`/`set -x`/`--force`/`unpublish`
- [x] 1.2 A test that the README installs with `npm install webusb-mtp` with no "not published" note, and that its "Releasing" section names the version bump, the workflow, `NPM_TOKEN` and trusted publishing
- [x] 1.3 See them fail before the workflow and README exist

## 2. Workflow and README

- [x] 2.1 `.github/workflows/release.yml`
- [x] 2.2 README: "Releasing" section; drop the "Not published yet" note
- [x] 2.3 Tests, type check and build pass

## 3. Review and records

- [x] 3.1 Conformance review, 2 rounds (round 1: R1 two jobs, M1 failure handling, M2 secret expressions, R2 exact npm, S1 one at a time, R3 lock churn; round 2: 4 soft gaps fixed)
- [x] 3.2 `/security-review` of the diff and an attack test (the workflow handles a secret): 14 edits, then 6 more after the approval gate, all caught
- [x] 3.3 ADRs and lessons

## 4. Owner, after merge

- [ ] 4.0 Before the first release: Settings → Environments → New environment `npm`, required reviewer the owner, deployment branches `main` only
- [ ] 4.1 Run the release on `main`; set up trusted publishing for `webusb-mtp` on npmjs.com; delete the token and the `NPM_TOKEN` secret
- [ ] 4.2 The next release, with no secret, publishes through trusted publishing (open question 0)

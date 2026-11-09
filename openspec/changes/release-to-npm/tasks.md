## 1. Tests first

- [ ] 1.1 Add `yaml` as a dev dependency and `test/releaseWorkflow.test.ts`: manual trigger only, publish job guarded to `main`, permissions exactly `contents: read` + `id-token: write`, every action pinned to a SHA, `NPM_TOKEN` only in the publish step, `npm ci` before `npm publish --access public --provenance`, npm 11 installed, Node 22
- [ ] 1.2 A test that the README's "Releasing" section names the version bump, the workflow, `NPM_TOKEN` and trusted publishing
- [ ] 1.3 See them fail before the workflow and README exist

## 2. Workflow and README

- [ ] 2.1 `.github/workflows/release.yml`
- [ ] 2.2 README: "Releasing" section; the install note says the package is published by this workflow
- [ ] 2.3 Tests, type check and build pass

## 3. Review and records

- [ ] 3.1 Conformance review
- [ ] 3.2 `/security-review` of the diff and an attack test (the workflow handles a secret)
- [ ] 3.3 ADRs and lessons

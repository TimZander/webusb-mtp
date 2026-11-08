## 1. Tests first

- [ ] 1.1 Copy the four modules' tests and the fake USB device into `test/`, with relative imports and illustrative device names
- [ ] 1.2 Add tests for the scenarios the app tested only through its client: stale session reopened, events unblocking a write, WebUSB availability, no console output, string round trip and large u64 where missing
- [ ] 1.3 See the new tests fail before the code is in place

## 2. Code

- [ ] 2.1 Copy `container.ts`, `dataset.ts`, `transport.ts`, `session.ts` into `src/`, with relative imports and generic wording in comments and notes
- [ ] 2.2 Add `src/webusb.ts` with `webUsbAvailable()` and `src/index.ts` exporting the public API
- [ ] 2.3 Tests, type check and build pass

## 3. Package and CI

- [ ] 3.1 `package.json`: name, version, MIT, `type: module`, `exports`, `types`, `files`, scripts; `tsconfig.json` and `tsconfig.build.json`
- [ ] 3.2 `.github/workflows/ci.yml`: `npm ci`, type check, tests, build
- [ ] 3.3 README: what it is, browser support, usage, scope

## 4. Review and records

- [ ] 4.1 Conformance review
- [ ] 4.2 ADRs and lessons
- [ ] 4.3 Scan the diff for private material from the source app

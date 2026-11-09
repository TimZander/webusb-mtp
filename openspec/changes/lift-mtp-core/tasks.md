## 1. Tests first

- [x] 1.1 Copy the four modules' tests and the fake USB device into `test/`, with relative imports and illustrative device names
- [x] 1.2 Add tests for the scenarios the app's tests don't cover: stale session reopened, events unblocking a write, WebUSB availability, no console output, transaction ids, a read with no data, an unexpected container breaking the session, an answer just before the write completes, a hanging control request, abort, an over-long string, undecodable data leaving the session usable, and the codec scenarios' exact values where missing
- [x] 1.3 See the new tests fail before the code is in place

## 2. Code

- [x] 2.1 Copy `container.ts`, `dataset.ts`, `transport.ts`, `session.ts` into `src/`, with relative imports and generic wording in comments and notes
- [x] 2.2 Make `DataWriter.string` throw for a string of over 254 UTF-16 units, naming the limit (the one behaviour change)
- [x] 2.3 Add `src/webusb.ts` with `webUsbAvailable()` and `src/index.ts` exporting the public API
- [x] 2.4 Tests, type check and build pass

## 3. Package and CI

- [x] 3.1 `package.json`: name, version, MIT, `type: module`, `exports`, `types`, `files`, scripts; `tsconfig.json` and `tsconfig.build.json`
- [x] 3.2 `.github/workflows/ci.yml`: `npm ci`, type check, tests, build
- [x] 3.3 README: what it is, browser support, usage, scope

## 4. Review and records

- [x] 4.1 Conformance review
- [x] 4.2 ADRs and lessons
- [x] 4.3 Scan the diff for private material from the source app

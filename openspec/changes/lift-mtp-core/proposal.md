## Why

A web app that writes files to a USB device (it began as a Garmin map app) carries a small,
working Media Transfer Protocol (MTP) stack over WebUSB. Nothing in that stack is tied to one
vendor, and no maintained MTP-over-WebUSB library for the browser exists. Lifting it into its own
MIT-licensed library lets other projects use it and lets vendor-specific code (Garmin's, first)
build on it from a separate repository.

## What Changes

- Add the library's code, lifted as it is from that app: container framing, dataset encoding,
  the WebUSB transport and the MTP session, plus a WebUSB availability check. Path aliases
  become relative imports; comments lose the app's issue numbers and test-round notes; wording
  in comments and diagnostic notes goes from "watch" to "device". One fix: writing a string too
  long for MTP's u8 count throws instead of producing a corrupt dataset.
- Add their tests, and the scripted fake USB device they run against, as a test helper.
- Add tests for scenarios the app covered only through its own code (a stale session, events
  unblocking a write, the availability check).
- Package it for npm without publishing: `package.json` exports, an ES module build to `dist`
  with type declarations, a `files` list. Plain GitHub Actions CI runs `npm ci`, the type check,
  the tests and the build.
- A README: what it is, browser support, a usage example, scope.

## Capabilities

### New Capabilities

- `mtp-codec`: MTP containers and datasets, encoded and decoded, and code names for logs.
- `mtp-transport`: finding a device's MTP interface, claiming it over WebUSB, and moving
  containers and events over its endpoints.
- `mtp-session`: MTP operations with transaction ids, response codes, timeouts and recovery.

### Modified Capabilities

None (the repository has no specs yet).

## Impact

- New code under `src/`, tests under `test/`, packaging, CI and README.
- Out of scope: anything vendor-specific (Garmin's vendor and product ids, its "Garmin mode",
  its folders and file formats), user-facing hints per platform, logging. They stay with the
  app or go to a later Garmin module.

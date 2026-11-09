---
status: accepted
date: 2026-11-08
decision-makers: the owner (ready for npm, not published; plain Actions CI), Claude (the how)
---
# ES modules and declarations built by `tsc`; WebUSB types as a dependency; plain CI

## Context and Problem Statement

The owner wants the package ready for npm without publishing it, and CI as plain GitHub Actions
rather than the shared ci-recipes. The public types name `USBDevice`, which only
`@types/w3c-web-usb` declares.

## Considered Options

- Bundle with a bundler (tsup, Vite library mode) to ESM and CJS.
- Compile with `tsc` to ESM and `.d.ts` in `dist`, with source maps and `src` shipped.
- For the WebUSB types: a dev dependency (consumers add it), a dependency, or a peer dependency.

## Decision Outcome

Chosen option: `tsc` to ESM only, because the code has no dependencies to bundle and every
WebUSB browser runs ESM. `@types/w3c-web-usb` is a dependency, and `index.ts` carries
`/// <reference types="w3c-web-usb" preserve="true" />` so the published declarations pull those
types in even for a consumer with `types: []` (checked by packing and compiling a consumer).
`files` ships `dist`, `src` (for the source maps), `LICENSE` and `README.md`. CI runs `npm ci`,
the type check, the tests and the build on Node 22.

### Consequences

- Good, because the package is small (about 22 kB packed) and its types work without setup.
- Bad, because there is no CommonJS build; a CJS consumer must use dynamic `import()`.
- Bad, because sdd's `prepare` script runs on `npm pack` and git installs. It does nothing harmful,
  but it is noise in a library; revisit before publishing.

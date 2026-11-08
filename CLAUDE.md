# CLAUDE.md

Guidance for agents working in this repository.

## Spec-driven workflow

@.claude/sdd-workflow.md

## Project

TypeScript library: MTP over WebUSB, browser only, no runtime dependencies besides the WebUSB types.

- `src/`: `container.ts` and `dataset.ts` (pure codec), `transport.ts` (WebUSB), `session.ts` (MTP
  operations), `webusb.ts`, `index.ts` (the public API: everything they export).
- `test/`: vitest in Node against `test/fakeMtpDevice.ts`, a scripted fake `USBDevice`.
- Commands: `npm ci`, `npm run typecheck`, `npm test`, `npm run build` (to `dist/`).
- Generic MTP only: no vendor ids or vendor vocabulary. Garmin helpers belong in `garmin-mtp`, a separate library built on this one.
- The library never writes to the console.

ADR detail: learning

---
status: accepted
date: 2026-11-08
decision-makers: Claude (lane), within the owner's "webusb.ts too if it's generic"
---
# Only `webUsbAvailable()` leaves the app's `webusb.ts`; Garmin ids stay out

## Context and Problem Statement

The app's `webusb.ts` holds Garmin's USB vendor id, a WebUSB availability check, a hash of the
app's build inputs and a byte formatter for its dialog. The owner said to bring it "if it's
generic", and to let Garmin's vendor and product ids appear only where the core uses them.

## Considered Options

- Bring the whole file.
- Bring only the availability check.
- Bring nothing; let callers test `navigator.usb` themselves.

## Decision Outcome

Chosen option: "Bring only the availability check", because it is the only generic part and every
caller needs it. No core module reads the vendor id (the app's client does, for its Garmin-mode
check), so it stays out with the rest.

### Consequences

- Good, because the library carries no vendor ids at all.
- Bad, because the app's `webusb.ts` and the library's diverge in content, which the later
  switch-over has to handle.

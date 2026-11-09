---
status: accepted
date: 2026-11-08
decision-makers: Claude (lane), for the owner's review
---
# Two bug fixes while lifting, in spite of "as they are"

## Context and Problem Statement

The owner asked for the code to come over as it is. Writing its spec and reviewing the code
against it turned up two defects: the dataset writer masked a string's u8 count, so a name of 255
or more UTF-16 units produced a corrupt dataset; and after a write timed out, a throw from the
caller's `onNote` skipped marking the session broken and closing the device, leaving later
operations to go onto a pipe with a transfer pending.

## Considered Options

- Lift them unchanged and specify them as they are.
- Lift them unchanged, leave them unspecified, and fix them in a later change.
- Fix both in this change, spec first, and say so in the proposal.

## Decision Outcome

Chosen option: "Fix both in this change", because specifying them would bless a corrupt dataset
and a stuck pipe, and leaving them unspecified would ship a spec with known holes. Both are a few
lines with a test seen to fail first. The string writer now throws naming the 254-unit limit; the
diagnosis swallows note-callback errors so the timeout still closes the device.

### Consequences

- Good, because the library starts without two known bugs.
- Bad, because the app's copy keeps them until it switches over; the app should get the same
  fixes. The app is private and was not changed here.

## More Information

The first was found by the spec review (round 1), the second by the conformance review's probe of
a throwing callback.

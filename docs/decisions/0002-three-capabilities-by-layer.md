---
status: accepted
date: 2026-11-08
decision-makers: Claude (lane), for the owner's review
---
# Three capabilities, one per layer

## Context and Problem Statement

The lifted code needs a spec. The app specified it through user-facing capabilities (a USB probe
page and a send dialog), which mix app behaviour with protocol behaviour. How should the
library's spec be cut?

## Considered Options

- One capability, `mtp`, for the whole library.
- One per layer: `mtp-codec` (pure bytes), `mtp-transport` (WebUSB), `mtp-session` (operations).
- One per operation family (reading, writing, setup).

## Decision Outcome

Chosen option: "One per layer", because each layer is one module with its own tests, so a
requirement, its code and its test live side by side, and a change to one layer touches one spec.
The WebUSB availability check goes in `mtp-transport`, the only layer touching WebUSB; "the
library writes no logs" went there too after the spec review, as its test runs across all layers.

### Consequences

- Good, because conformance reviews can check one module against one spec.
- Bad, because a few rules span layers (timeouts exist in both transport setup and session), so
  they appear in two specs.

## More Information

Rejected: a single `mtp` capability would have exceeded 25 requirements in one file; operation
families would have split the transport's packet rules from the session that depends on them.

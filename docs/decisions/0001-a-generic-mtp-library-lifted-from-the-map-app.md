---
status: accepted
date: 2026-11-08
decision-makers: the owner
---
# A generic MTP-over-WebUSB library, lifted from the map app

## Context and Problem Statement

A web app that sends Garmin maps to a watch carries a working MTP stack over WebUSB. Most of it
isn't Garmin-specific, and no maintained MTP library for the browser exists. Should the stack
become a library of its own, and how much of it?

## Considered Options

- Keep it inside the app.
- Lift the whole USB layer, Garmin client included.
- Lift only the generic core (containers, datasets, transport, session) and leave everything
  Garmin-specific for a separate module.

## Decision Outcome

Chosen option: "Lift only the generic core", the owner's decision. The library is public, MIT,
named `webusb-mtp`. The app's Garmin client (Garmin mode, the `GARMIN` folder, map headers, user
hints, logging) stays behind and may become its own library, `garmin-mtp`, on top of this one. The app keeps
its own copy until a later change switches it over.

### Consequences

- Good, because other projects get a tested MTP stack, and the vendor boundary is explicit.
- Good, because code and tests move as they are, so the behaviour comes with its track record.
- Bad, because two copies exist until the app switches, and they can drift.

## More Information

Evidence: no file of the four core modules imports anything Garmin-specific. The only vendor
values were in comments, test fixtures and the fake device's defaults, which this change makes
illustrative. Change: `lift-mtp-core`.

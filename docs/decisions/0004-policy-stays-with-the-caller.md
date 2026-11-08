---
status: proposed
date: 2026-11-08
decision-makers: Claude (lane); open questions 1 and 2 in lift-mtp-core's design, for the owner
---
# Retries, device quirks, hints and logging stay with the caller

## Context and Problem Statement

Four app requirements the owner asked to lift are partly implemented outside the core, in the
app's client: reopening a stale session, recognizing "Garmin mode", explaining claim failures per
platform, and keeping serial numbers out of logs. Should the library take that behaviour on?

## Considered Options

- Move each behaviour into the library (a reopen option, a quirks table, hint texts, a redacting
  logger).
- Specify only what the core does, so callers can implement the policy: the session stays usable
  after `SessionAlreadyOpen`; setup errors name their step; the library logs nothing.

## Decision Outcome

Chosen option: "Specify only what the core does", because the change moves code as it is, and
each of the four is a policy (when to retry, which vendor quirks, which words, what to redact)
that depends on the app. Garmin mode is a Garmin fact for `garmin-mtp`, the Garmin module.

### Consequences

- Good, because the library adds no behaviour that wasn't in the lifted code, and has no vendor
  knowledge.
- Bad, because every caller writes the same few lines for a stale session. A later change can add
  a helper if callers ask for one.

## More Information

Status is `proposed` until the owner answers open questions 1 and 2 of the change's design.

## Context

The code comes from a web app that builds Garmin maps and sends them to a watch over WebUSB. Its
MTP stack is four modules (container framing, datasets, transport, session) and a WebUSB
availability check. They have no Garmin logic: the app's own client (choosing the device, Garmin
mode, the `GARMIN` folder, map headers, user hints and logging) sits on top of them. That client
stays in the app; a Garmin module, `garmin-mtp`, may follow in its own repository.

## Goals / Non-Goals

**Goals:** the four modules and their tests, as they are; a spec for what they do; packaging ready
for npm; CI.

**Non-Goals:** publishing to npm; switching the app over; Garmin-specific code; new behaviour.

## Decisions

- **Three capabilities, by layer.** `mtp-codec` (pure bytes), `mtp-transport` (WebUSB), and
  `mtp-session` (MTP operations), matching the modules, so a requirement lives where its code is.
  The WebUSB check goes in `mtp-transport`, the only layer that touches WebUSB.
- **The code moves unchanged** except: `@/` aliases become relative imports; comments lose the
  app's issue numbers and hardware-round notes; the three diagnostic notes that said "the watch"
  (an early answer, the cancel asked, the cancel failed) say "the device". Behaviour is the same,
  with two exceptions below.
- **One fix: an over-long MTP string throws.** The app's writer masked the u8 count, so a string
  of 255 or more UTF-16 units produced a corrupt dataset. Specifying that would bless a bug; the
  writer now throws, naming the 254-character limit.
- **Second fix, found by the conformance review: a throwing note callback can't leave a stuck pipe
  open.** After a write timed out, a throw from the caller's `onNote` escaped before the session
  marked itself broken and closed the device, so later operations went onto a pipe with a transfer
  still pending. Notes during that diagnosis now swallow callback errors, and the timeout is thrown.
- **The public API is everything the four modules export, plus `webUsbAvailable()`,** re-exported
  from `src/index.ts`: the code tables, encoders and decoders, `DataReader`/`DataWriter`,
  `findMtpInterface`, `MtpTransport`, `UsbSetupError`, `describeError`, `MtpSession`, its error
  classes, `ROOT_PARENT` and the timeout constants, and their types. Nothing is added or hidden.
- **The app's `webusb.ts` is split.** Only `webUsbAvailable()` is generic. Garmin's vendor id
  (not used by the core), the app's build-input hash and its byte formatter stay behind.
- **The fake USB device comes along as a test helper** (`test/fakeMtpDevice.ts`). It is generic
  MTP; its default vendor, product and names change to illustrative values.
- **`@types/w3c-web-usb` is a dependency**, not a dev dependency: the published declarations name
  `USBDevice`, so a TypeScript consumer needs those types.
- **Build with `tsc`** to ES modules with declarations in `dist`. No bundler: the code has no
  dependencies to bundle.

## Provenance

Each lifted requirement, and the app requirement it came from (by title):

| Library requirement | From the app's requirement |
|---|---|
| mtp-transport: WebUSB availability can be checked | watch-usb-probe: "WebUSB availability is explained" (the check only, not the message) |
| mtp-transport: The MTP interface is identified | watch-usb-probe: "MTP interface is identified" |
| mtp-transport: Setup claims the interface in order | watch-usb-probe: "Read-only MTP session runs in order" (the setup steps) |
| mtp-transport: Setup failures name their step | watch-usb-probe: "Claim failures explain likely causes" (the error; hints stay with the app) |
| mtp-transport: Setup calls time out | watch-usb-probe: "Operations time out"; watch-transfer: "Steps time out" |
| mtp-transport: Multi-transfer responses are read completely | watch-usb-probe: "Multi-transfer responses are read completely" |
| mtp-transport: Events are read; Event reading outlasts bad reads | watch-transfer: "The watch's events are read" |
| mtp-session: Operations time out | watch-usb-probe: "Operations time out"; watch-transfer: "Steps time out" |
| mtp-session: A write answered before its data is refused | watch-transfer: "Steps time out" (scenario "Watch answers before taking the data") |
| mtp-session: A write without an answer is diagnosed | watch-transfer: "Steps time out" (scenario "A write gets no answer") |
| mtp-session: A stale session can be reopened | watch-usb-probe: "A stale session is reopened" (the session's part; the retry stays with the caller) |
| mtp-session: A refused operation leaves the session usable; A broken pipe stops the session | watch-usb-probe: "Failures stop dependent steps and still clean up" (the session's part) |
| mtp-transport: Device identifiers reach only the caller | watch-usb-probe: "Logs omit device serial numbers" (the library logs nothing; redaction stays with the caller) |
| mtp-transport: The transport is released on every exit | watch-transfer: "The watch is always released" (the transport's part) |

New requirements, written from the app's tests rather than its specs: all of `mtp-codec`;
mtp-session "The session offers MTP's file operations", "Every answered operation is reported",
"Data phases are reported"; mtp-transport "A data phase's header goes in its own USB packet".

Not lifted: watch-usb-probe "Garmin mode is recognized" (Garmin's vendor and product ids; no core
code uses them), and every requirement about the app's dialogs, logs, folders and maps.

## Risks / Trade-offs

- [The spec describes the code as found, including choices tuned on one device (64 KiB writes,
  16 KiB reads, 60 s write answers)] → they are defaults or constants a later change can expose.
- [The app keeps its own copy for now] → the two can drift until the app switches over; that is
  a later change in the app.

## Open Questions

1. **Should the library retry a stale session itself?** The app's client closes and reopens on
   `0x201E`. *Assumption:* no; the session reports the error and stays usable, and the caller
   retries (as the app does), so the library adds no policy.
2. **Should "Garmin mode" (vendor `0x091E`, product `0x0003`) be detected here?** *Assumption:* no;
   it is a Garmin fact and belongs in `garmin-mtp`.
3. **Should timeouts, read size and write chunk size be options?** Timeouts and read size already
   are; the 64 KiB write chunk is a constant. *Assumption:* leave it as is until someone needs it.
4. **Package name on npm.** *Assumption:* `webusb-mtp`, unscoped, matching the repository; checked
   only when publishing.
5. **Minimum Node for development.** *Assumption:* Node 20 or later (CI runs 22).

# Decisions

Architecture and process decisions, one per file, as [MADR 4.0](https://adr.github.io/madr/)
records: `NNNN-short-title.md`, numbered in order. Copy [`template.md`](template.md) to start
one. A superseded record stays, with its status set to `superseded by NNNN`.

| No. | Decision | Status |
|---|---|---|
| [0001](0001-a-generic-mtp-library-lifted-from-the-map-app.md) | A generic MTP-over-WebUSB library, lifted from the map app | accepted |
| [0002](0002-three-capabilities-by-layer.md) | Three capabilities, one per layer | accepted |
| [0003](0003-only-the-webusb-check-leaves-webusb-ts.md) | Only `webUsbAvailable()` leaves the app's `webusb.ts`; Garmin ids stay out | accepted |
| [0004](0004-policy-stays-with-the-caller.md) | Retries, device quirks, hints and logging stay with the caller | proposed |
| [0005](0005-two-fixes-while-lifting.md) | Two bug fixes while lifting, in spite of "as they are" | accepted |
| [0006](0006-package-as-esm-with-declarations.md) | ES modules and declarations built by `tsc`; WebUSB types as a dependency; plain CI | accepted |
| [0007](0007-lock-file-written-with-npm-11.md) | The lock file is written with npm 11 | accepted |
| [0008](0008-how-the-change-was-run.md) | How `lift-mtp-core` was split, reviewed and stopped | accepted |

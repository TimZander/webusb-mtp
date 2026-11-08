# webusb-mtp

Media Transfer Protocol (MTP) over [WebUSB](https://wicg.github.io/webusb/), in TypeScript, for the
browser. List a device's storages and files, read part of a file, send files and delete them, from
a web page and with no native helper.

It began as the USB layer of a web app that sends maps to Garmin watches. Nothing in it is
vendor-specific.

## Browser support

WebUSB is available only in Chromium-based browsers (Chrome, Edge, Opera, Chrome on Android), and
only in a secure context (HTTPS or `localhost`). Firefox and Safari, including every browser on iOS,
don't have it. `webUsbAvailable()` tells you before you ask for a device.

The operating system must also let the browser claim the device's MTP interface: on Windows the
built-in MTP driver usually holds it, on macOS Image Capture or Photos may, and on Android the
system's own MTP host may. A claim that fails comes back as a `UsbSetupError` naming the step, so
your app can explain this to its users.

## Install

```sh
npm install webusb-mtp
```

(Not published yet: install from a local build or a git checkout until it is.)

## Usage

```ts
import { MtpSession, MtpTransport, ObjectFormat, ROOT_PARENT, findMtpInterface, webUsbAvailable } from 'webusb-mtp'

if (!webUsbAvailable()) throw new Error('This browser has no WebUSB')

// Must run from a user gesture, such as a button's click handler.
const device = await navigator.usb.requestDevice({ filters: [] })
const choice = findMtpInterface(device)
if (!choice) throw new Error('This device has no MTP interface')

const transport = new MtpTransport(device, choice)
try {
  await transport.setup()
  transport.startEvents((event) => console.debug('MTP event', event.code, event.params))

  const session = new MtpSession(transport)
  const info = await session.getDeviceInfo()
  console.log(info.manufacturer, info.model)

  await session.openSession()
  const [storageId] = await session.getStorageIds()
  for (const handle of await session.getObjectHandles(storageId, ROOT_PARENT)) {
    const object = await session.getObjectInfo(handle)
    console.log(object.isFolder ? 'folder' : 'file', object.filename, object.objectCompressedSize)
  }

  // Send a file to the storage root.
  const bytes = new TextEncoder().encode('hello')
  await session.sendObjectInfo(storageId, ROOT_PARENT, {
    storageId,
    objectFormat: ObjectFormat.Undefined,
    objectCompressedSize: bytes.length,
    parentObject: ROOT_PARENT,
    associationType: 0,
    filename: 'hello.txt',
  })
  await session.sendObject(bytes, (sent, total) => console.log(`${sent} / ${total}`))

  await session.closeSession()
} finally {
  await transport.close()
}
```

Errors tell you what state the connection is in:

- `MtpResponseError`: the device answered with a code other than OK (`responseCode`). The session
  is still usable.
- `MtpTimeoutError`, or any other error from a transfer: the connection's state is unknown, so the
  session has closed the device (`session.broken` is true) and refuses further operations.
- `UsbSetupError`: opening or claiming failed (`step`, `cause`, `timedOut`).

The library writes nothing to the console. Pass `onOperation` and `onNote` to `MtpSession` to log
operations and diagnostics yourself. DeviceInfo includes the device's serial number, so redact it
before you share a log.

## Scope

Generic MTP only: container and dataset encoding, the WebUSB transport, and the MTP operations a
file manager needs (GetDeviceInfo, OpenSession, CloseSession, GetStorageIDs, GetStorageInfo,
GetObjectHandles, GetObjectInfo, GetPartialObject, SendObjectInfo, SendObject, DeleteObject).
Helpers for Garmin devices (their USB ids, their "Garmin mode", their folders and file formats) will
live in a separate library, `garmin-mtp`, built on this one.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build   # ES modules and type declarations in dist/
```

Tests run in Node against a scripted fake USB device (`test/fakeMtpDevice.ts`). The behaviour is
specified in `openspec/specs/`, and changes go through spec-driven development (see `CLAUDE.md`).

## License

MIT

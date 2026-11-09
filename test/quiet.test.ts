// Spec: mtp-transport › "Device identifiers reach only the caller".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MtpSession } from '../src/session.js'
import { MtpTransport, findMtpInterface } from '../src/transport.js'
import { createFakeMtpDevice } from './fakeMtpDevice.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('console', () => {
  it('stays silent through a full run with a serial number', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m))
    const STORAGE = 0x00010001
    const fake = createFakeMtpDevice({
      usbSerial: 'SN-EXAMPLE',
      mtpSerial: 'SN-EXAMPLE',
      objectAddedEvent: 'nonblocking',
      objects: [{ handle: 1, storageId: STORAGE, parent: 0xffffffff, name: 'DATA', folder: true }],
    })
    const t = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await t.setup()
    t.startEvents(() => {})
    const session = new MtpSession(t)
    expect((await session.getDeviceInfo()).serialNumber).toBe('SN-EXAMPLE')
    await session.openSession()
    await session.getStorageInfo(STORAGE)
    const { handle } = await session.sendObjectInfo(STORAGE, 1, {
      storageId: STORAGE,
      objectFormat: 0x3000,
      objectCompressedSize: 3,
      parentObject: 1,
      associationType: 0,
      filename: 'a.bin',
    })
    await session.sendObject(new Uint8Array([1, 2, 3]))
    await session.getObjectInfo(handle)
    await session.deleteObject(handle)
    await session.closeSession()
    await t.close()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

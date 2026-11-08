// Smoke test for the simulated device the MTP tests run against.
import { describe, it, expect } from 'vitest'
import { BULK_IN, BULK_OUT, createFakeMtpDevice } from './fakeMtpDevice.js'
import { ContainerType, decodeContainer, encodeContainer } from '../src/container.js'
import { encodeObjectInfo } from '../src/dataset.js'

describe('fake MTP device', () => {
  it('answers GetDeviceInfo with a data container then an OK response', async () => {
    const fake = createFakeMtpDevice()
    await fake.device.open()
    await fake.device.transferOut(BULK_OUT, encodeContainer({ type: 1, code: 0x1001, transactionId: 0 }))
    const data = await fake.device.transferIn(BULK_IN, 16384)
    expect(decodeContainer(new Uint8Array(data.data!.buffer)).type).toBe(ContainerType.Data)
    const resp = await fake.device.transferIn(BULK_IN, 16384)
    const c = decodeContainer(new Uint8Array(resp.data!.buffer))
    expect([c.type, c.code]).toEqual([ContainerType.Response, 0x2001])
    expect(fake.sentOperations).toEqual([0x1001])
  })

  it('refuses session operations before OpenSession', async () => {
    const fake = createFakeMtpDevice()
    await fake.device.open()
    await fake.device.transferOut(BULK_OUT, encodeContainer({ type: 1, code: 0x1004, transactionId: 1 }))
    const resp = await fake.device.transferIn(BULK_IN, 16384)
    expect(decodeContainer(new Uint8Array(resp.data!.buffer)).code).toBe(0x2003)
  })

  it('leaves a read pending when nothing is queued, until close', async () => {
    const fake = createFakeMtpDevice()
    await fake.device.open()
    const pending = fake.device.transferIn(BULK_IN, 16384)
    await fake.device.close()
    await expect(pending).rejects.toThrow(/disconnected/)
  })
})

describe('fake MTP device: sending', () => {
  type Fake = ReturnType<typeof createFakeMtpDevice>
  async function command(fake: Fake, code: number, tid: number, params: number[] = []) {
    await fake.device.transferOut(BULK_OUT, encodeContainer({ type: 1, code, transactionId: tid, params }))
  }
  async function data(fake: Fake, code: number, tid: number, payload: Uint8Array) {
    await fake.device.transferOut(BULK_OUT, encodeContainer({ type: 2, code, transactionId: tid, payload }))
  }
  async function response(fake: Fake) {
    return decodeContainer(new Uint8Array((await fake.device.transferIn(BULK_IN, 16384)).data!.buffer))
  }

  it('creates an object from SendObjectInfo + SendObject and deletes it', async () => {
    const fake = createFakeMtpDevice({ objects: [{ handle: 1, storageId: 0x00010001, parent: 0xffffffff, name: 'DATA', folder: true }] })
    await fake.device.open()
    await command(fake, 0x1002, 0, [1])
    await response(fake)
    await command(fake, 0x100c, 1, [0x00010001, 1])
    await data(fake, 0x100c, 1, encodeObjectInfo({ storageId: 0x00010001, objectFormat: 0x3000, objectCompressedSize: 3, parentObject: 1, associationType: 0, filename: 'x.bin' }))
    const info = await response(fake)
    expect(info.code).toBe(0x2001)
    const handle = info.params[2]
    await command(fake, 0x100d, 2)
    await data(fake, 0x100d, 2, new Uint8Array([1, 2, 3]))
    expect((await response(fake)).code).toBe(0x2001)
    expect(fake.objects.find((o) => o.handle === handle)).toMatchObject({ name: 'x.bin', parent: 1 })
    await command(fake, 0x100b, 3, [handle])
    expect((await response(fake)).code).toBe(0x2001)
    expect(fake.objects.some((o) => o.handle === handle)).toBe(false)
    expect(fake.sentOperations).toEqual([0x1002, 0x100c, 0x100d, 0x100b])
  })
})

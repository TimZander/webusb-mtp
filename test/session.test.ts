// Spec: mtp-session › every requirement (operations, transaction ids, reports, refused and
// broken operations, stale sessions, timeouts, early answers, write diagnostics).
import { describe, it, expect, vi } from 'vitest'
import { MtpResponseError, MtpSession, MtpTimeoutError, OPERATION_TIMEOUT_MS, WRITE_ANSWER_TIMEOUT_MS } from '../src/session.js'
import { MtpTransport, findMtpInterface } from '../src/transport.js'
import { createFakeMtpDevice, type FakeDeviceOptions } from './fakeMtpDevice.js'
import { encodeObjectInfo } from '../src/dataset.js'

async function connect(options: FakeDeviceOptions = {}, timeoutMs?: number) {
  const fake = createFakeMtpDevice(options)
  const transport = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
  await transport.setup()
  const ops: string[] = []
  const session = new MtpSession(transport, {
    timeoutMs,
    onOperation: (op) => ops.push(`${op.name} ${op.code} ${op.responseName} ${op.responseCode}`),
  })
  return { fake, session, ops }
}

const STORAGE = 0x00010001
const objects = [
  { handle: 1, storageId: STORAGE, parent: 0xffffffff, name: 'DATA', folder: true },
  { handle: 2, storageId: STORAGE, parent: 1, name: 'a.bin', data: new Uint8Array(4096).fill(0xab) },
]

describe('MtpSession operations', () => {
  it('runs the read-only operations and decodes their data', async () => {
    const { session, ops } = await connect({ objects, model: 'Model Y' })
    expect((await session.getDeviceInfo()).model).toBe('Model Y')
    await session.openSession()
    expect(session.isOpen).toBe(true)
    const ids = await session.getStorageIds()
    expect(ids).toEqual([STORAGE])
    expect((await session.getStorageInfo(STORAGE)).storageDescription).toBe('Internal Storage')
    expect(await session.getObjectHandles(STORAGE)).toEqual([1])
    expect(await session.getObjectHandles(STORAGE, 1)).toEqual([2])
    expect((await session.getObjectInfo(2)).filename).toBe('a.bin')
    const head = await session.getPartialObject(2, 0, 512)
    expect(head.length).toBe(512)
    expect(head[0]).toBe(0xab)
    await session.closeSession()
    expect(session.isOpen).toBe(false)
    expect(ops[0]).toBe('GetDeviceInfo 0x1001 OK 0x2001')
    expect(ops.slice(-1)[0]).toBe('CloseSession 0x1003 OK 0x2001')
  })

  it('reads a folder listing that spans several transfers', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      handle: 100 + i,
      storageId: STORAGE,
      parent: 0xffffffff,
      name: `f${i}.txt`,
    }))
    const { session } = await connect({ objects: many, packetSize: 64, maxTransferBytes: 64 })
    await session.openSession()
    expect(await session.getObjectHandles(STORAGE)).toHaveLength(300)
  })

  it('throws MtpResponseError for a non-OK response and keeps the pipe healthy', async () => {
    const { session, ops } = await connect({ failWith: (op) => (op === 0x1004 ? 0x2002 : undefined) })
    await session.openSession()
    const err = await session.getStorageIds().catch((e) => e)
    expect(err).toBeInstanceOf(MtpResponseError)
    expect(err.operation).toBe(0x1004)
    expect(err.responseCode).toBe(0x2002)
    expect(err.message).toMatch(/GetStorageIDs \(0x1004\).*GeneralError \(0x2002\)/)
    expect(session.broken).toBe(false)
    expect(ops.slice(-1)[0]).toBe('GetStorageIDs 0x1004 GeneralError 0x2002')
    await session.closeSession()
  })

  it('marks the pipe broken and closes the device when a transfer throws', async () => {
    const { fake, session } = await connect({ throwOn: (op) => op === 0x1005 })
    await session.openSession()
    await expect(session.getStorageInfo(STORAGE)).rejects.toThrow(/transfer error/)
    expect(session.broken).toBe(true)
    expect(fake.opened).toBe(false)
  })

  it('times out an unanswered operation and closes the device', async () => {
    const { fake, session } = await connect({ objects, hangOn: (op) => op === 0x1008 }, 20)
    await session.openSession()
    const err = await session.getObjectInfo(2).catch((e) => e)
    expect(err).toBeInstanceOf(MtpTimeoutError)
    expect(err.message).toMatch(/GetObjectInfo \(0x1008\).*0\.02 s/)
    expect(session.broken).toBe(true)
    expect(fake.opened).toBe(false)
  })

  it('defaults to a 10 second timeout', () => {
    expect(OPERATION_TIMEOUT_MS).toBe(10_000)
  })

  it('refuses operations once the pipe is broken', async () => {
    const { fake, session } = await connect({ throwOn: (op) => op === 0x1004 })
    await session.openSession()
    await session.getStorageIds().catch(() => {})
    const before = fake.sentOperations.length
    await expect(session.closeSession()).rejects.toThrow(/broken/)
    expect(fake.sentOperations.length).toBe(before)
  })
})

describe('MtpSession sending', () => {
  const folder = [{ handle: 1, storageId: STORAGE, parent: 0xffffffff, name: 'DATA', folder: true }]
  const info = (size: number) => ({
    storageId: STORAGE,
    objectFormat: 0x3000,
    objectCompressedSize: size,
    parentObject: 1,
    associationType: 0,
    filename: 'trip.bin',
  })

  it('announces an object with SendObjectInfo and gets its new handle', async () => {
    const { session, ops } = await connect({ objects: folder })
    await session.openSession()
    const sent = await session.sendObjectInfo(STORAGE, 1, info(3))
    expect(sent).toMatchObject({ storageId: STORAGE, parent: 1 })
    expect(sent.handle).toBeGreaterThan(1)
    expect(ops.slice(-1)[0]).toBe('SendObjectInfo 0x100C OK 0x2001')
  })

  it('sends the object with progress up to the whole container', async () => {
    const { fake, session } = await connect({ objects: folder })
    await session.openSession()
    const { handle } = await session.sendObjectInfo(STORAGE, 1, info(200_000))
    const progress: number[] = []
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251)
    await session.sendObject(bytes, (sent, total) => progress.push(sent / total))
    expect(progress.slice(-1)[0]).toBe(1)
    expect(progress.length).toBeGreaterThan(2)
    expect(fake.objects.find((o) => o.handle === handle)?.data).toEqual(bytes)
  })

  it('times out a send that stops making progress, and closes the device', async () => {
    const { fake, session } = await connect({ objects: folder, stallDataAfterBytes: 70_000 }, 30)
    await session.openSession()
    await session.sendObjectInfo(STORAGE, 1, info(200_000))
    const err = await session.sendObject(new Uint8Array(200_000)).catch((e) => e)
    expect(err).toBeInstanceOf(MtpTimeoutError)
    expect(err.message).toMatch(/SendObject \(0x100D\)/)
    expect(session.broken).toBe(true)
    expect(fake.opened).toBe(false)
  })

  it('does not time out a slow send that keeps making progress', async () => {
    const { session } = await connect({ objects: folder, outDelayMs: 20 }, 50)
    await session.openSession()
    await session.sendObjectInfo(STORAGE, 1, info(250_000))
    // Four 64 KB writes at 20 ms each: 80 ms in total, more than the 50 ms timeout.
    await expect(session.sendObject(new Uint8Array(250_000))).resolves.toBeUndefined()
  })

  it('deletes an object', async () => {
    const { fake, session } = await connect({
      objects: [...folder, { handle: 7, storageId: STORAGE, parent: 1, name: 'old.bin', size: 10 }],
    })
    await session.openSession()
    await session.deleteObject(7)
    expect(fake.objects.some((o) => o.handle === 7)).toBe(false)
  })

  it('reports a refused SendObjectInfo as a response error with the pipe intact', async () => {
    const { session } = await connect({ objects: folder, failWith: (op) => (op === 0x100c ? 0x200c : undefined) })
    await session.openSession()
    const err = await session.sendObjectInfo(STORAGE, 1, info(3)).catch((e) => e)
    expect(err).toBeInstanceOf(MtpResponseError)
    expect(err.responseCode).toBe(0x200c)
    expect(session.broken).toBe(false)
  })
})

describe('MtpSession write answers', () => {
  const folder = [{ handle: 1, storageId: STORAGE, parent: 0xffffffff, name: 'DATA', folder: true }]
  const info = { storageId: STORAGE, objectFormat: 0x3000, objectCompressedSize: 3, parentObject: 1, associationType: 0, filename: 'a.bin' }

  async function writer(options: FakeDeviceOptions, timeoutMs: number, writeTimeoutMs: number) {
    const fake = createFakeMtpDevice({ objects: folder, ...options })
    const transport = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await transport.setup()
    const ops: { name: string; elapsedMs: number }[] = []
    const session = new MtpSession(transport, { timeoutMs, writeTimeoutMs, onOperation: (op) => ops.push(op) })
    await session.openSession()
    return { fake, session, ops }
  }

  it('waits longer than the operation timeout for the answer to SendObjectInfo', async () => {
    const { session, ops } = await writer({ answerDelayMs: (op) => (op === 0x100c ? 60 : 0) }, 20, 300)
    await expect(session.sendObjectInfo(STORAGE, 1, info)).resolves.toMatchObject({ parent: 1 })
    expect(ops.slice(-1)[0].elapsedMs).toBeGreaterThanOrEqual(55)
  })

  it('waits longer for the answer after the SendObject data too', async () => {
    const { session } = await writer({ answerDelayMs: (op) => (op === 0x100d ? 60 : 0) }, 20, 300)
    await session.sendObjectInfo(STORAGE, 1, info)
    await expect(session.sendObject(new Uint8Array(3))).resolves.toBeUndefined()
  })

  it('times out when the write answer takes longer than the write timeout', async () => {
    const { fake, session } = await writer({ answerDelayMs: (op) => (op === 0x100c ? 200 : 0) }, 20, 50)
    const err = await session.sendObjectInfo(STORAGE, 1, info).catch((e) => e)
    expect(err).toBeInstanceOf(MtpTimeoutError)
    expect(err.message).toMatch(/0\.05 s/)
    expect(fake.opened).toBe(false)
  })

  it('keeps the short timeout for other operations', async () => {
    const { session } = await writer({ hangOn: (op) => op === 0x1004 }, 20, 5_000)
    const started = Date.now()
    await expect(session.getStorageIds()).rejects.toBeInstanceOf(MtpTimeoutError)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('defaults to a 60 second write timeout', () => {
    expect(WRITE_ANSWER_TIMEOUT_MS).toBe(60_000)
  })
})

describe('MtpSession write diagnostics', () => {
  const folder = [{ handle: 1, storageId: STORAGE, parent: 0xffffffff, name: 'DATA', folder: true }]
  const info = { storageId: STORAGE, objectFormat: 0x3000, objectCompressedSize: 3, parentObject: 1, associationType: 0, filename: 'a.bin' }

  async function writer(options: FakeDeviceOptions) {
    const fake = createFakeMtpDevice({ objects: folder, ...options })
    const transport = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await transport.setup()
    const notes: string[] = []
    const dataOut: [number, number][] = []
    const written: [number, number][] = []
    const payloads: Uint8Array[] = []
    const session = new MtpSession(transport, {
      timeoutMs: 20,
      writeTimeoutMs: 40,
      onNote: (t) => notes.push(t),
      onDataOut: (code, bytes) => {
        dataOut.push([code, bytes.length])
        payloads.push(bytes)
      },
      onDataWritten: (code, bytes) => written.push([code, bytes.length]),
    })
    await session.openSession()
    return { fake, session, notes, dataOut, written, payloads }
  }

  it('reports the file info before and after the device accepts it', async () => {
    const { session, dataOut, written, payloads } = await writer({})
    await session.sendObjectInfo(STORAGE, 1, info)
    expect(dataOut).toHaveLength(1)
    expect(dataOut[0][0]).toBe(0x100c)
    expect(written).toEqual(dataOut)
    expect(Array.from(payloads[0])).toEqual(Array.from(encodeObjectInfo(info)))
  })

  it('catches an answer that comes before the data is accepted, and closes the device', async () => {
    const { fake, session, notes, written } = await writer({ answerBeforeData: (op) => (op === 0x100c ? 0x2005 : undefined) })
    const err = await session.sendObjectInfo(STORAGE, 1, info).catch((e) => e)
    expect(err).toBeInstanceOf(MtpResponseError)
    expect(err.responseCode).toBe(0x2005)
    expect(err.early).toBe(true)
    expect(notes.join('\n')).toMatch(/answered before accepting/)
    expect(written).toEqual([])
    expect(session.broken).toBe(true)
    expect(fake.opened).toBe(false)
  })

  it('after a write timeout, reads the MTP status and cancels the transaction before closing', async () => {
    const { fake, session, notes } = await writer({ hangOn: (op) => op === 0x100c, deviceStatus: 0x2019 })
    await expect(session.sendObjectInfo(STORAGE, 1, info)).rejects.toBeInstanceOf(MtpTimeoutError)
    expect(fake.controlRequests.map((r) => r.request)).toEqual([0x67, 0x64])
    // Cancel carries the cancellation code 0x4001 and the transaction id, little-endian.
    const cancel = fake.controlRequests[1].data
    expect(cancel.slice(0, 2)).toEqual([0x01, 0x40])
    expect(cancel).toHaveLength(6)
    // SendObjectInfo is the first transaction after OpenSession: id 1.
    expect(cancel.slice(2)).toEqual([1, 0, 0, 0])
    expect(notes.join('\n')).toMatch(/MTP status: DeviceBusy \(0x2019\)/)
    expect(notes.join('\n')).toMatch(/cancel/i)
    expect(fake.opened).toBe(false)
  })

  it('still closes when the status cannot be read', async () => {
    const { fake, session, notes } = await writer({ hangOn: (op) => op === 0x100c, controlFails: true })
    await expect(session.sendObjectInfo(STORAGE, 1, info)).rejects.toBeInstanceOf(MtpTimeoutError)
    expect(notes.join('\n')).toMatch(/couldn't be read/)
    expect(fake.opened).toBe(false)
  })

  it('does not query status or cancel after a read times out', async () => {
    const { fake, session } = await writer({ hangOn: (op) => op === 0x1004 })
    await expect(session.getStorageIds()).rejects.toBeInstanceOf(MtpTimeoutError)
    expect(fake.controlRequests).toEqual([])
  })
})

// A transport stand-in for exchanges the fake device can't script.
function stubTransport(overrides: Partial<Record<keyof MtpTransport, unknown>>) {
  const calls: string[] = []
  const base = {
    sendCommand: async () => {},
    readContainer: async () => ({ type: 3, code: 0x2001, transactionId: 1, length: 12, params: [], payload: new Uint8Array(0) }),
    sendData: async () => {},
    getDeviceStatus: async () => 0x2001,
    cancelTransaction: async () => {
      calls.push('cancel')
    },
    abort: async () => {
      calls.push('abort')
    },
  }
  return { transport: { ...base, ...overrides } as unknown as MtpTransport, calls }
}

describe('spec scenarios (mtp-session)', () => {
  async function recordingIds() {
    const fake = createFakeMtpDevice({ objects })
    const tids: number[] = []
    const out = fake.device.transferOut.bind(fake.device)
    fake.device.transferOut = async (ep: number, data: BufferSource) => {
      const bytes = data as Uint8Array
      if (bytes.length >= 12 && bytes[4] === 1) tids.push(new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true))
      return out(ep, data)
    }
    const transport = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await transport.setup()
    return { session: new MtpSession(transport), tids }
  }

  it('numbers transactions 0, 0, 1, 2 for GetDeviceInfo, OpenSession and the next two operations', async () => {
    const { session, tids } = await recordingIds()
    await session.getDeviceInfo()
    await session.openSession()
    await session.getStorageIds()
    await session.getStorageInfo(STORAGE)
    expect(tids).toEqual([0, 0, 1, 2])
  })

  it('restarts transaction ids after reopening', async () => {
    const { session, tids } = await recordingIds()
    await session.openSession()
    await session.getStorageIds()
    await session.closeSession()
    await session.openSession()
    await session.getStorageIds()
    expect(tids.slice(1)).toEqual([1, 2, 0, 1])
  })

  it('marks an early OK answer to a write as early, and closes the device', async () => {
    const { fake, session } = await connect({
      objects: [{ handle: 1, storageId: STORAGE, parent: 0xffffffff, name: 'DATA', folder: true }],
      answerBeforeData: (op) => (op === 0x100c ? 0x2001 : undefined),
    }, 20)
    await session.openSession()
    const info = { storageId: STORAGE, objectFormat: 0x3000, objectCompressedSize: 3, parentObject: 1, associationType: 0, filename: 'a.bin' }
    const err = await session.sendObjectInfo(STORAGE, 1, info).catch((e) => e)
    expect(err).toBeInstanceOf(MtpResponseError)
    expect([err.responseCode, err.early]).toEqual([0x2001, true])
    expect(fake.opened).toBe(false)
  })

  it('still breaks the session and closes when the note callback throws after a write timeout', async () => {
    const { transport, calls } = stubTransport({ readContainer: () => new Promise(() => {}) })
    const session = new MtpSession(transport, {
      writeTimeoutMs: 20,
      onNote: () => {
        throw new Error('note failed')
      },
    })
    const info = { storageId: 1, objectFormat: 0x3000, objectCompressedSize: 3, parentObject: 2, associationType: 0, filename: 'a.bin' }
    await expect(session.sendObjectInfo(1, 2, info)).rejects.toBeInstanceOf(MtpTimeoutError)
    expect(session.broken).toBe(true)
    expect(calls).toContain('abort')
  })

  it('uses a 10 second operation limit and a 60 second write limit by default', async () => {
    vi.useFakeTimers()
    try {
      const { transport } = stubTransport({ readContainer: () => new Promise(() => {}) })
      const read = new MtpSession(transport).getDeviceInfo().catch((e) => e)
      await vi.advanceTimersByTimeAsync(9_999)
      let settled = false
      void read.then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await read).toBeInstanceOf(MtpTimeoutError)

      const { transport: t2 } = stubTransport({ readContainer: () => new Promise(() => {}) })
      const info = { storageId: 1, objectFormat: 0x3000, objectCompressedSize: 3, parentObject: 2, associationType: 0, filename: 'a.bin' }
      const write = new MtpSession(t2).sendObjectInfo(1, 2, info).catch((e) => e)
      let writeSettled = false
      void write.then(() => (writeSettled = true))
      await vi.advanceTimersByTimeAsync(59_999)
      expect(writeSettled).toBe(false)
      await vi.advanceTimersByTimeAsync(10_000)
      const err = await write
      expect(err).toBeInstanceOf(MtpTimeoutError)
      expect(err.timeoutMs).toBe(60_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a read answered OK with no data, and stays usable', async () => {
    const { session } = await connect({ failWith: (op) => (op === 0x1004 ? 0x2001 : undefined) })
    await session.openSession()
    await expect(session.getStorageIds()).rejects.toThrow(/GetStorageIDs returned no data/)
    expect(session.broken).toBe(false)
    await expect(session.closeSession()).resolves.toBeUndefined()
  })

  it('returns empty bytes for a GetPartialObject answered without data', async () => {
    const { session } = await connect({ objects, failWith: (op) => (op === 0x101b ? 0x2001 : undefined) })
    await session.openSession()
    expect((await session.getPartialObject(2, 0, 16)).length).toBe(0)
  })

  it('leaves the session usable after undecodable data', async () => {
    const { session } = await connect({ corruptData: (op) => op === 0x1005 })
    await session.openSession()
    await expect(session.getStorageInfo(STORAGE)).rejects.toThrow(/past the end/)
    expect(session.broken).toBe(false)
    await expect(session.closeSession()).resolves.toBeUndefined()
  })

  it('breaks the session on a container that is not the expected response', async () => {
    const { transport, calls } = stubTransport({
      readContainer: async () => ({ type: 4, code: 0x4002, transactionId: 0, length: 16, params: [1], payload: new Uint8Array(4) }),
    })
    const session = new MtpSession(transport)
    await expect(session.openSession()).rejects.toThrow(/Expected a response/)
    expect(session.broken).toBe(true)
    expect(calls).toContain('abort')
  })

  it("breaks the session when a caller's callback throws", async () => {
    const fake = createFakeMtpDevice()
    const transport = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await transport.setup()
    const session = new MtpSession(transport, {
      onOperation: () => {
        throw new Error('callback failed')
      },
    })
    await expect(session.getDeviceInfo()).rejects.toThrow(/callback failed/)
    expect(session.broken).toBe(true)
    expect(fake.opened).toBe(false)
  })

  it('lets a caller reopen a session left open by another program', async () => {
    const { session } = await connect({ initialSessionOpen: true })
    const err = await session.openSession().catch((e) => e)
    expect(err).toBeInstanceOf(MtpResponseError)
    expect(err.responseCode).toBe(0x201e)
    expect(session.broken).toBe(false)
    await session.closeSession()
    await session.openSession()
    expect(session.isOpen).toBe(true)
    expect(await session.getStorageIds()).toEqual([STORAGE])
  })

  it('does not call an answer early when the write completes within 1 second after it', async () => {
    const { transport } = stubTransport({
      sendData: () => new Promise<void>((r) => setTimeout(r, 50)),
      readContainer: async () => ({ type: 3, code: 0x2001, transactionId: 1, length: 24, params: [1, 2, 3], payload: new Uint8Array(12) }),
    })
    const written: number[] = []
    const session = new MtpSession(transport, { onDataWritten: (code) => written.push(code) })
    const info = { storageId: 1, objectFormat: 0x3000, objectCompressedSize: 3, parentObject: 2, associationType: 0, filename: 'a.bin' }
    await expect(session.sendObjectInfo(1, 2, info)).resolves.toEqual({ storageId: 1, parent: 2, handle: 3 })
    expect(written).toEqual([0x100c])
    expect(session.broken).toBe(false)
  })

  it('gives up on a hanging status request after 2 seconds and still cancels and closes', async () => {
    const notes: string[] = []
    const { transport, calls } = stubTransport({
      readContainer: () => new Promise(() => {}),
      getDeviceStatus: () => new Promise(() => {}),
    })
    const session = new MtpSession(transport, { writeTimeoutMs: 20, onNote: (t) => notes.push(t) })
    const info = { storageId: 1, objectFormat: 0x3000, objectCompressedSize: 3, parentObject: 2, associationType: 0, filename: 'a.bin' }
    const started = Date.now()
    await expect(session.sendObjectInfo(1, 2, info)).rejects.toBeInstanceOf(MtpTimeoutError)
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900)
    expect(notes.join('\n')).toMatch(/couldn't be read/)
    expect(calls).toEqual(['cancel', 'abort'])
  })
})

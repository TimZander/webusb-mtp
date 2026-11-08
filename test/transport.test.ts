// Spec: mtp-transport › "The MTP interface is identified", "Setup claims the interface in
// order", "Setup failures name their step", "Setup calls time out", "Multi-transfer responses are
// read completely", "A data phase's header goes in its own USB packet", "Events are read",
// "The transport is released on every exit".
import { describe, it, expect } from 'vitest'
import { MtpTransport, UsbSetupError, findMtpInterface } from '../src/transport.js'
import { ContainerType } from '../src/container.js'
import { MtpSession } from '../src/session.js'
import {
  BULK_IN,
  BULK_OUT,
  INTERRUPT_IN,
  createFakeMtpDevice,
  mtpConfiguration,
  type FakeConfigurationSpec,
} from './fakeMtpDevice.js'

const mtpEndpoints = [
  { endpointNumber: BULK_IN, direction: 'in' as const, type: 'bulk' as const },
  { endpointNumber: BULK_OUT, direction: 'out' as const, type: 'bulk' as const },
  { endpointNumber: INTERRUPT_IN, direction: 'in' as const, type: 'interrupt' as const },
]

describe('findMtpInterface', () => {
  it('prefers a still-image (0x06) interface over a vendor-specific one', () => {
    const config: FakeConfigurationSpec = {
      configurationValue: 1,
      interfaces: [
        { interfaceNumber: 0, alternates: [{ interfaceClass: 0xff, endpoints: mtpEndpoints }] },
        { interfaceNumber: 1, alternates: [{ interfaceClass: 0x06, interfaceName: 'MTP', endpoints: mtpEndpoints }] },
      ],
    }
    const choice = findMtpInterface(createFakeMtpDevice({ configurations: [config] }).device)
    expect(choice).toMatchObject({ interfaceNumber: 1, interfaceClass: 0x06, bulkIn: 1, bulkOut: 2, interruptIn: 3 })
    expect(choice!.reason).toMatch(/0x06/)
  })

  it('falls back to a vendor-specific (0xFF) interface', () => {
    const choice = findMtpInterface(createFakeMtpDevice({ configurations: [mtpConfiguration(512, 0xff)] }).device)
    expect(choice).toMatchObject({ interfaceNumber: 0, interfaceClass: 0xff })
    expect(choice!.reason).toMatch(/0xFF/)
  })

  it('ignores candidates without the three endpoints and returns null when none remain', () => {
    const config: FakeConfigurationSpec = {
      configurationValue: 1,
      interfaces: [
        { interfaceNumber: 0, alternates: [{ interfaceClass: 0x06, endpoints: mtpEndpoints.slice(0, 2) }] },
        { interfaceNumber: 1, alternates: [{ interfaceClass: 0x08, endpoints: mtpEndpoints }] },
      ],
    }
    expect(findMtpInterface(createFakeMtpDevice({ configurations: [config] }).device)).toBeNull()
  })

  it('records a non-zero alternate setting and its configuration', () => {
    const config: FakeConfigurationSpec = {
      configurationValue: 2,
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            { alternateSetting: 0, interfaceClass: 0x06, endpoints: [] },
            { alternateSetting: 1, interfaceClass: 0x06, endpoints: mtpEndpoints },
          ],
        },
      ],
    }
    expect(findMtpInterface(createFakeMtpDevice({ configurations: [config] }).device)).toMatchObject({
      configurationValue: 2,
      alternateSetting: 1,
    })
  })
})

describe('MtpTransport.setup', () => {
  it('selects the configuration when none is active, claims, and skips alternate 0', async () => {
    const fake = createFakeMtpDevice({ activeConfiguration: null })
    const steps: string[] = []
    const t = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await t.setup((m) => steps.push(m))
    expect(fake.setupCalls).toEqual(['open', 'selectConfiguration', 'claimInterface'])
    expect(steps.join('\n')).toMatch(/Selected configuration 1/)
  })

  it('does not reselect an active configuration', async () => {
    const fake = createFakeMtpDevice({ activeConfiguration: 1 })
    const steps: string[] = []
    await new MtpTransport(fake.device, findMtpInterface(fake.device)!).setup((m) => steps.push(m))
    expect(fake.setupCalls).toEqual(['open', 'claimInterface'])
    expect(steps.join('\n')).toMatch(/already active/)
  })

  it('selects a non-zero alternate setting after claiming', async () => {
    const config = mtpConfiguration()
    config.interfaces[0].alternates = [
      { alternateSetting: 0, interfaceClass: 0x06, endpoints: [] },
      { ...config.interfaces[0].alternates[0], alternateSetting: 1 },
    ]
    const fake = createFakeMtpDevice({ configurations: [config], activeConfiguration: 1 })
    const steps: string[] = []
    await new MtpTransport(fake.device, findMtpInterface(fake.device)!).setup((m) => steps.push(m))
    expect(fake.setupCalls).toEqual(['open', 'claimInterface', 'selectAlternateInterface'])
    expect(steps.join('\n')).toMatch(/alternate setting 1/)
  })

  it('times out a setup call that never completes and closes the device', async () => {
    const fake = createFakeMtpDevice({ setupHang: { claimInterface: true } })
    const err = await new MtpTransport(fake.device, findMtpInterface(fake.device)!, undefined, 20).setup().catch((e) => e)
    expect(err).toBeInstanceOf(UsbSetupError)
    expect(err.step).toBe('claimInterface')
    expect(err.timedOut).toBe(true)
    expect(fake.opened).toBe(false)
  })

  it('wraps a failing setup call in UsbSetupError naming the step', async () => {
    const fake = createFakeMtpDevice({ setupError: { claimInterface: new DOMException('Unable to claim interface.', 'NetworkError') } })
    const err = await new MtpTransport(fake.device, findMtpInterface(fake.device)!).setup().catch((e) => e)
    expect(err).toBeInstanceOf(UsbSetupError)
    expect(err.step).toBe('claimInterface')
    expect(err.message).toMatch(/Unable to claim interface/)
  })
})

async function openTransport(options: Parameters<typeof createFakeMtpDevice>[0], readSize?: number) {
  const fake = createFakeMtpDevice(options)
  const t = new MtpTransport(fake.device, findMtpInterface(fake.device)!, readSize)
  await t.setup()
  return { fake, t }
}

describe('MtpTransport reads', () => {
  it('reassembles a data phase spread over several transfers', async () => {
    const ops = Array.from({ length: 200 }, (_, i) => 0x1000 + i) // ~400-byte op list
    const { t } = await openTransport({ packetSize: 64, operationsSupported: ops }, 64)
    await t.sendCommand(0x1001, 0, [])
    const data = await t.readContainer()
    expect(data.type).toBe(ContainerType.Data)
    expect(data.payload.length).toBeGreaterThan(400)
    expect((await t.readContainer()).code).toBe(0x2001)
  })

  // A partial read of 52 bytes makes a 64-byte data container: an exact multiple of the
  // packet size.
  const exactObjects = [{ handle: 5, storageId: 0x00010001, parent: 0xffffffff, name: 'a.bin', data: new Uint8Array(100).fill(7) }]

  it('skips the zero-length packet after an exact multiple', async () => {
    const { t } = await openTransport({ packetSize: 64, sendZlp: true, objects: exactObjects })
    await t.sendCommand(0x1002, 0, [1])
    expect((await t.readContainer()).code).toBe(0x2001)
    await t.sendCommand(0x101b, 1, [5, 0, 52])
    const data = await t.readContainer()
    expect(data.payload).toEqual(new Uint8Array(52).fill(7))
    const resp = await t.readContainer()
    expect([resp.type, resp.code, resp.params[0]]).toEqual([ContainerType.Response, 0x2001, 52])
  })

  it('skips a zero-length packet that arrives as its own transfer', async () => {
    const { fake, t } = await openTransport({ packetSize: 64, sendZlp: true, objects: exactObjects }, 64)
    await t.sendCommand(0x1002, 0, [1])
    await t.readContainer()
    await t.sendCommand(0x101b, 1, [5, 0, 52])
    expect((await t.readContainer()).payload.length).toBe(52)
    expect((await t.readContainer()).code).toBe(0x2001)
    expect(fake.emptyTransfers).toBe(1)
  })

  it('splits a data phase and response that arrive in one transfer without a ZLP', async () => {
    const { t } = await openTransport({ packetSize: 64, sendZlp: false, objects: exactObjects })
    await t.sendCommand(0x1002, 0, [1])
    await t.readContainer()
    await t.sendCommand(0x101b, 1, [5, 0, 52])
    expect((await t.readContainer()).payload.length).toBe(52)
    expect((await t.readContainer()).code).toBe(0x2001)
  })
})

describe('MtpTransport.close', () => {
  it('releases and closes, and never throws', async () => {
    const { fake, t } = await openTransport({})
    await t.close()
    expect(fake.setupCalls.slice(-2)).toEqual(['releaseInterface', 'close'])
    expect(fake.opened).toBe(false)
    await expect(t.close()).resolves.toBeUndefined()
  })
})

describe('MtpTransport.sendData', () => {
  async function sendAfterCommand(payloadLength: number, packetSize = 512) {
    const { fake, t } = await openTransport({ packetSize })
    await t.sendCommand(0x100d, 1, [])
    const progress: [number, number][] = []
    await t.sendData(0x100d, 1, new Uint8Array(payloadLength).fill(9), (sent, total) => progress.push([sent, total]))
    return { fake, progress, outs: fake.outTransfers.slice(1) }
  }

  it('sends the 12-byte header in its own transfer, then the payload in 64 KB transfers with progress', async () => {
    const { outs, progress } = await sendAfterCommand(150_000)
    const total = 150_000 + 12
    expect(outs).toEqual([12, 65_536, 65_536, 150_000 - 131_072])
    expect(progress).toEqual([
      [12, total],
      [12 + 65_536, total],
      [12 + 131_072, total],
      [total, total],
    ])
  })

  it('ends with a zero-length packet when the payload fills its last packet exactly', async () => {
    const { outs } = await sendAfterCommand(1024)
    expect(outs).toEqual([12, 1024, 0])
  })

  it('sends no zero-length packet otherwise', async () => {
    const { outs } = await sendAfterCommand(1000)
    expect(outs).toEqual([12, 1000])
  })

  it('uses the bulk OUT packet size for the zero-length rule', async () => {
    const { outs } = await sendAfterCommand(64, 64)
    expect(outs).toEqual([12, 64, 0])
  })

  it('sends only the header for an empty payload', async () => {
    const { outs } = await sendAfterCommand(0)
    expect(outs).toEqual([12])
  })
})

describe('MtpTransport events', () => {
  it('reads events from the interrupt endpoint until the device is closed', async () => {
    const fake = createFakeMtpDevice({ objectAddedEvent: 'nonblocking' })
    const t = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await t.setup()
    const seen: number[] = []
    t.startEvents((ev) => seen.push(ev.code))
    await new Promise((r) => setTimeout(r, 0))
    expect(fake.pendingEventReads).toBe(1)
    await t.close()
    await new Promise((r) => setTimeout(r, 0))
    expect(fake.pendingEventReads).toBe(0)
    expect(seen).toEqual([])
  })

  it('clears a stalled interrupt endpoint and waits before reading again, instead of spinning', async () => {
    const fake = createFakeMtpDevice({ interruptStalled: true })
    const t = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await t.setup()
    t.startEvents(() => {})
    await new Promise((r) => setTimeout(r, 50))
    expect(fake.clearHalts).toEqual([`in ${INTERRUPT_IN}`])
    // One stalled read, then (after a short wait) one pending read on the cleared endpoint.
    expect(fake.interruptReads).toBeLessThanOrEqual(2)
    await t.close()
  })
})

describe('spec scenarios (mtp-transport)', () => {
  it('aborts by closing the device without releasing the interface', async () => {
    const { fake, t } = await openTransport({})
    await t.abort()
    expect(fake.setupCalls).not.toContain('releaseInterface')
    expect(fake.setupCalls.slice(-1)[0]).toBe('close')
    expect(fake.opened).toBe(false)
  })

  it('reads the event a device holds its answer for, so SendObjectInfo completes', async () => {
    const fake = createFakeMtpDevice({
      objectAddedEvent: 'blocking',
      objects: [{ handle: 1, storageId: 0x00010001, parent: 0xffffffff, name: 'DATA', folder: true }],
    })
    const t = new MtpTransport(fake.device, findMtpInterface(fake.device)!)
    await t.setup()
    const events: { code: number; params: number[] }[] = []
    t.startEvents((ev) => events.push({ code: ev.code, params: ev.params }))
    const session = new MtpSession(t, { timeoutMs: 500, writeTimeoutMs: 500 })
    await session.openSession()
    const sent = await session.sendObjectInfo(0x00010001, 1, {
      storageId: 0x00010001,
      objectFormat: 0x3000,
      objectCompressedSize: 3,
      parentObject: 1,
      associationType: 0,
      filename: 'a.bin',
    })
    expect(events).toContainEqual({ code: 0x4002, params: [sent.handle] })
    await t.close()
  })
})

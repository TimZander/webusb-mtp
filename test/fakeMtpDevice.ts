// A scripted stand-in for a USB-connected MTP device, for node tests of the MTP
// transport and session. It implements the slice of WebUSB's USBDevice they use
// and answers MTP commands from a small in-memory model (storages, folders, files).
//
// Bulk IN is modelled the way a host controller sees it: the device queues packets of at
// most `packetSize` bytes; a transferIn(length) completes on a short packet (including a
// zero-length one) or once `length` bytes have arrived. So a data phase that is an exact
// multiple of the packet size, sent without a ZLP, merges with the response that follows
// into one transfer — exactly the case the transport must handle.

import { ContainerType, ObjectFormat, ResponseCode, decodeContainer, decodeHeader, encodeContainer } from '../src/container.js'
import { DataWriter, decodeObjectInfo, encodeObjectInfo, type ObjectInfo } from '../src/dataset.js'

export interface FakeStorage {
  id: number
  description: string
  volumeLabel?: string
  maxCapacity: number
  freeSpace: number
}

export interface FakeObject {
  handle: number
  storageId: number
  // 0xFFFFFFFF for an object in the storage root.
  parent: number
  name: string
  folder?: boolean
  size?: number
  data?: Uint8Array
  // MTP date (YYYYMMDDThhmmss) reported as the object's modification date.
  modified?: string
}

export type SetupStep = 'open' | 'selectConfiguration' | 'claimInterface' | 'selectAlternateInterface'

export interface FakeEndpointSpec {
  endpointNumber: number
  direction: 'in' | 'out'
  type: 'bulk' | 'interrupt' | 'isochronous'
  packetSize?: number
}

export interface FakeAlternateSpec {
  alternateSetting?: number
  interfaceClass: number
  interfaceSubclass?: number
  interfaceProtocol?: number
  interfaceName?: string | null
  endpoints: FakeEndpointSpec[]
}

export interface FakeInterfaceSpec {
  interfaceNumber: number
  alternates: FakeAlternateSpec[]
}

export interface FakeConfigurationSpec {
  configurationValue: number
  configurationName?: string | null
  interfaces: FakeInterfaceSpec[]
}

export interface FakeDeviceOptions {
  packetSize?: number
  sendZlp?: boolean
  vendorId?: number
  productId?: number
  manufacturerName?: string
  productName?: string
  usbSerial?: string
  configurations?: FakeConfigurationSpec[]
  // configurationValue active before open(); null means unconfigured.
  activeConfiguration?: number | null
  manufacturer?: string
  model?: string
  deviceVersion?: string
  mtpSerial?: string
  operationsSupported?: number[]
  storages?: FakeStorage[]
  objects?: FakeObject[]
  // Answer an operation with this response code instead of handling it.
  failWith?: (code: number, params: number[]) => number | undefined
  // Make the bulk IN read for this operation throw.
  throwOn?: (code: number, params: number[]) => boolean
  // Never answer this operation (until the device is closed).
  hangOn?: (code: number, params: number[]) => boolean
  // Make a setup call throw.
  setupError?: Partial<Record<SetupStep, Error>>
  // Make a setup call never complete (until the device is closed).
  setupHang?: Partial<Record<SetupStep, boolean>>
  // Cap the bytes one transferIn returns, so a container spans several transfers whatever
  // the reader asks for.
  maxTransferBytes?: number
  // Start with an MTP session already open, as another app (Android's MTP host) leaves it.
  initialSessionOpen?: boolean
  // Objects created by SendObject report this many bytes more (or fewer) than they received.
  reportedSizeDelta?: number
  // Stop accepting a data-out phase after this many bytes (the transfer hangs until close).
  stallDataAfterBytes?: number
  // Delay every bulk OUT write of a data-out phase by this many milliseconds.
  outDelayMs?: number
  // Answer a write operation (after its data-out phase) only after this many milliseconds.
  answerDelayMs?: (code: number) => number
  // Answer a write command at once with this code, then never accept its data-out phase.
  answerBeforeData?: (code: number) => number | undefined
  // The status the MTP class request GetDeviceStatus (0x67) reports (OK by default).
  deviceStatus?: number
  // Make class control requests throw.
  controlFails?: boolean
  // Queue an ObjectAdded event (0x4002) on the interrupt endpoint when SendObjectInfo succeeds.
  // 'blocking' also withholds the answer until that event has been read (as one real device
  // appeared to do).
  objectAddedEvent?: 'blocking' | 'nonblocking'
  // Answer this operation with truncated data (2 bytes) that can't be decoded.
  corruptData?: (code: number) => boolean
  // Interrupt endpoint reads answer with status 'stall' until clearHalt('in', INTERRUPT_IN).
  interruptStalled?: boolean
}

export const BULK_IN = 1
export const BULK_OUT = 2
export const INTERRUPT_IN = 3

export function mtpConfiguration(packetSize = 512, interfaceClass = 0x06): FakeConfigurationSpec {
  return {
    configurationValue: 1,
    configurationName: null,
    interfaces: [
      {
        interfaceNumber: 0,
        alternates: [
          {
            alternateSetting: 0,
            interfaceClass,
            interfaceSubclass: interfaceClass === 0x06 ? 1 : 0,
            interfaceProtocol: interfaceClass === 0x06 ? 1 : 0,
            interfaceName: 'MTP',
            endpoints: [
              { endpointNumber: BULK_IN, direction: 'in', type: 'bulk', packetSize },
              { endpointNumber: BULK_OUT, direction: 'out', type: 'bulk', packetSize },
              { endpointNumber: INTERRUPT_IN, direction: 'in', type: 'interrupt', packetSize: 64 },
            ],
          },
        ],
      },
    ],
  }
}

export const ALL_READ_OPERATIONS = [0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1007, 0x1008, 0x101b]

export interface FakeMtpDevice {
  device: USBDevice
  // Every MTP operation code received, in order.
  sentOperations: number[]
  // Every setup call made, in order.
  setupCalls: string[]
  readonly opened: boolean
  // How many transferIn calls returned zero bytes.
  readonly emptyTransfers: number
  // How many transferIn calls were made on the interrupt endpoint.
  readonly interruptReads: number
  // Every clearHalt call, as "<direction> <endpoint>".
  clearHalts: string[]
  // The device's objects, live: SendObject adds to it, DeleteObject removes from it.
  readonly objects: FakeObject[]
  // Byte length of every bulk OUT transfer, in order (0 = a zero-length packet).
  readonly outTransfers: number[]
  // Every ObjectInfo received with SendObjectInfo, in order.
  readonly objectInfos: ObjectInfo[]
  // Class control requests received: request code, and the data sent with it.
  readonly controlRequests: { request: number; data: number[] }[]
  // Interrupt-endpoint reads currently waiting for an event.
  readonly pendingEventReads: number
}

function toConfiguration(spec: FakeConfigurationSpec): USBConfiguration {
  const interfaces = spec.interfaces.map((i) => {
    const alternates = i.alternates.map(
      (a) =>
        ({
          alternateSetting: a.alternateSetting ?? 0,
          interfaceClass: a.interfaceClass,
          interfaceSubclass: a.interfaceSubclass ?? 0,
          interfaceProtocol: a.interfaceProtocol ?? 0,
          interfaceName: a.interfaceName ?? null,
          endpoints: a.endpoints.map(
            (e) =>
              ({
                endpointNumber: e.endpointNumber,
                direction: e.direction,
                type: e.type,
                packetSize: e.packetSize ?? 512,
              }) as USBEndpoint,
          ),
        }) as USBAlternateInterface,
    )
    return { interfaceNumber: i.interfaceNumber, alternate: alternates[0], alternates, claimed: false } as USBInterface
  })
  return {
    configurationValue: spec.configurationValue,
    configurationName: spec.configurationName ?? null,
    interfaces,
  } as USBConfiguration
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function createFakeMtpDevice(options: FakeDeviceOptions = {}): FakeMtpDevice {
  const packetSize = options.packetSize ?? 512
  const sendZlp = options.sendZlp ?? true
  const storages = options.storages ?? [
    { id: 0x00010001, description: 'Internal Storage', volumeLabel: '', maxCapacity: 32_000_000_000, freeSpace: 12_500_000_000 },
  ]
  const objects = [...(options.objects ?? [])]
  let nextHandle = Math.max(0x1000, ...objects.map((o) => o.handle + 1))
  // A command whose data-out phase is still arriving.
  let incoming: { op: number; tid: number; params: number[]; bytes: number[]; length?: number } | null = null
  // The object announced by SendObjectInfo, waiting for its SendObject.
  let pendingObject: FakeObject | null = null
  const outTransfers: number[] = []
  const configurations = (options.configurations ?? [mtpConfiguration(packetSize)]).map(toConfiguration)
  let activeConfiguration: number | null =
    options.activeConfiguration === undefined ? null : options.activeConfiguration

  const packets: Uint8Array[] = []
  const sentOperations: number[] = []
  const setupCalls: string[] = []
  let opened = false
  let sessionOpen = options.initialSessionOpen ?? false
  let throwNextRead = false
  let hanging: { reject: (e: Error) => void } | null = null
  // A bulk IN read waiting for the device to queue something (a slow answer).
  let waitingRead: (() => void) | null = null
  let emptyTransfers = 0
  let interruptReads = 0
  let interruptStalled = options.interruptStalled ?? false
  const clearHalts: string[] = []
  const objectInfos: ObjectInfo[] = []
  const controlRequests: { request: number; data: number[] }[] = []
  // Events queued on the interrupt endpoint, and answers held until their event is read.
  const events: { bytes: Uint8Array; release?: () => void }[] = []
  const eventReaders: { resolve: () => void; reject: (e: Error) => void }[] = []

  function queueEvent(code: number, params: number[], release?: () => void): void {
    events.push({ bytes: encodeContainer({ type: ContainerType.Event, code, transactionId: 0, params }), release })
    eventReaders.shift()?.resolve()
  }
  // After an early answer, the device refuses the data-out phase: writes hang until close.
  let refusingData = false

  // A transfer error on the bulk IN pipe: fail the read already waiting, or the next one.
  function failRead(): void {
    if (waitingRead) {
      const h = hanging
      waitingRead = null
      hanging = null
      h?.reject(new DOMException('A transfer error has occurred.', 'NetworkError'))
    } else {
      throwNextRead = true
    }
  }

  function queue(container: Uint8Array): void {
    for (let i = 0; i < container.length; i += packetSize) {
      packets.push(container.subarray(i, Math.min(i + packetSize, container.length)))
    }
    if (container.length % packetSize === 0 && sendZlp) packets.push(new Uint8Array(0))
    const wake = waitingRead
    waitingRead = null
    wake?.()
  }

  function respond(code: number, tid: number, params: number[] = []): void {
    queue(encodeContainer({ type: ContainerType.Response, code, transactionId: tid, params }))
  }

  function sendData(op: number, tid: number, payload: Uint8Array): void {
    if (options.corruptData?.(op)) payload = payload.subarray(0, 2)
    queue(encodeContainer({ type: ContainerType.Data, code: op, transactionId: tid, payload }))
  }

  function handle(op: number, tid: number, params: number[]): void {
    const forced = options.failWith?.(op, params)
    if (forced !== undefined) {
      respond(forced, tid)
      return
    }
    if (op !== 0x1001 && op !== 0x1002 && !sessionOpen) {
      respond(ResponseCode.SessionNotOpen, tid)
      return
    }
    switch (op) {
      case 0x1001: {
        const w = new DataWriter()
        w.u16(100)
        w.u32(6)
        w.u16(100)
        w.string('microsoft.com: 1.0;')
        w.u16(0)
        w.u16Array(options.operationsSupported ?? ALL_READ_OPERATIONS)
        w.u16Array([0x4002, 0x4003])
        w.u16Array([])
        w.u16Array([])
        w.u16Array([0x3000, 0x3001])
        w.string(options.manufacturer ?? 'Example Corp')
        w.string(options.model ?? 'Model X')
        w.string(options.deviceVersion ?? '15.08')
        w.string(options.mtpSerial ?? '')
        sendData(op, tid, w.toBytes())
        respond(ResponseCode.OK, tid)
        return
      }
      case 0x1002:
        if (sessionOpen) {
          respond(ResponseCode.SessionAlreadyOpen, tid)
          return
        }
        sessionOpen = true
        respond(ResponseCode.OK, tid)
        return
      case 0x1003:
        sessionOpen = false
        respond(ResponseCode.OK, tid)
        return
      case 0x1004: {
        const w = new DataWriter()
        w.u32Array(storages.map((s) => s.id))
        sendData(op, tid, w.toBytes())
        respond(ResponseCode.OK, tid)
        return
      }
      case 0x1005: {
        const s = storages.find((x) => x.id === params[0])
        if (!s) {
          respond(ResponseCode.InvalidStorageID, tid)
          return
        }
        const w = new DataWriter()
        w.u16(3)
        w.u16(2)
        w.u16(0)
        w.u64(s.maxCapacity)
        w.u64(s.freeSpace)
        w.u32(0xffffffff)
        w.string(s.description)
        w.string(s.volumeLabel ?? '')
        sendData(op, tid, w.toBytes())
        respond(ResponseCode.OK, tid)
        return
      }
      case 0x1007: {
        const [storageId, , parent] = params
        const list = objects.filter(
          (o) => (storageId === 0xffffffff || o.storageId === storageId) && o.parent === (parent ?? 0xffffffff),
        )
        const w = new DataWriter()
        w.u32Array(list.map((o) => o.handle))
        sendData(op, tid, w.toBytes())
        respond(ResponseCode.OK, tid)
        return
      }
      case 0x1008: {
        const o = objects.find((x) => x.handle === params[0])
        if (!o) {
          respond(ResponseCode.InvalidObjectHandle, tid)
          return
        }
        sendData(
          op,
          tid,
          encodeObjectInfo({
            storageId: o.storageId,
            objectFormat: o.folder ? ObjectFormat.Association : ObjectFormat.Undefined,
            objectCompressedSize: o.folder ? 0 : (o.size ?? o.data?.length ?? 0),
            parentObject: o.parent === 0xffffffff ? 0 : o.parent,
            associationType: o.folder ? 1 : 0,
            filename: o.name,
            dateModified: o.modified,
          }),
        )
        respond(ResponseCode.OK, tid)
        return
      }
      case 0x100b: {
        const i = objects.findIndex((x) => x.handle === params[0])
        if (i < 0) {
          respond(ResponseCode.InvalidObjectHandle, tid)
          return
        }
        objects.splice(i, 1)
        respond(ResponseCode.OK, tid)
        return
      }
      case 0x101b: {
        const o = objects.find((x) => x.handle === params[0])
        if (!o || o.folder) {
          respond(ResponseCode.InvalidObjectHandle, tid)
          return
        }
        const data = o.data ?? new Uint8Array(o.size ?? 0)
        const chunk = data.subarray(params[1], params[1] + params[2])
        sendData(op, tid, chunk)
        respond(ResponseCode.OK, tid, [chunk.length])
        return
      }
      default:
        respond(ResponseCode.OperationNotSupported, tid)
    }
  }

  // A data-out phase has fully arrived for SendObjectInfo or SendObject.
  function handleData(op: number, tid: number, params: number[], payload: Uint8Array): void {
    const forced = options.failWith?.(op, params)
    if (forced !== undefined) {
      respond(forced, tid)
      return
    }
    if (!sessionOpen) {
      respond(ResponseCode.SessionNotOpen, tid)
      return
    }
    if (op === 0x100c) {
      const [storageId, parent] = params
      if (!storages.some((st) => st.id === storageId)) {
        respond(ResponseCode.InvalidStorageID, tid)
        return
      }
      const parentObject = objects.find((o) => o.handle === parent)
      if (parent !== 0xffffffff && (!parentObject || !parentObject.folder)) {
        respond(ResponseCode.InvalidParentObject, tid)
        return
      }
      const info = decodeObjectInfo(payload)
      objectInfos.push(info)
      pendingObject = { handle: nextHandle++, storageId, parent, name: info.filename }
      const answer = () => respond(ResponseCode.OK, tid, [storageId, parent, pendingObject!.handle])
      if (options.objectAddedEvent === 'blocking') queueEvent(0x4002, [pendingObject.handle], answer)
      else {
        if (options.objectAddedEvent === 'nonblocking') queueEvent(0x4002, [pendingObject.handle])
        answer()
      }
      return
    }
    // 0x100D SendObject
    if (!pendingObject) {
      respond(0x2015, tid) // NoValidObjectInfo
      return
    }
    const created: FakeObject = { ...pendingObject, data: payload }
    if (options.reportedSizeDelta) created.size = payload.length + options.reportedSizeDelta
    objects.push(created)
    pendingObject = null
    respond(ResponseCode.OK, tid)
  }

  async function setup(step: SetupStep): Promise<void> {
    setupCalls.push(step)
    const err = options.setupError?.[step]
    if (err) throw err
    if (options.setupHang?.[step]) {
      await new Promise((_, reject) => {
        hanging = { reject }
      })
    }
  }

  const device = {
    vendorId: options.vendorId ?? 0x1234,
    productId: options.productId ?? 0x5678,
    manufacturerName: options.manufacturerName ?? 'Example Corp',
    productName: options.productName ?? 'Model X',
    serialNumber: options.usbSerial ?? '',
    usbVersionMajor: 2,
    usbVersionMinor: 0,
    usbVersionSubminor: 0,
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    deviceVersionMajor: 1,
    deviceVersionMinor: 0,
    deviceVersionSubminor: 0,
    configurations,
    get configuration() {
      return configurations.find((c) => c.configurationValue === activeConfiguration)
    },
    get opened() {
      return opened
    },
    async open() {
      // A hanging open still counts as opened, so close() can cancel it.
      opened = !!options.setupHang?.open
      await setup('open')
      opened = true
    },
    async close() {
      setupCalls.push('close')
      opened = false
      hanging?.reject(new DOMException('The device was disconnected.', 'NetworkError'))
      hanging = null
      for (const r of eventReaders.splice(0)) r.reject(new DOMException('The transfer was cancelled.', 'AbortError'))
    },
    async selectConfiguration(value: number) {
      await setup('selectConfiguration')
      activeConfiguration = value
    },
    async claimInterface(n: number) {
      await setup('claimInterface')
      const i = device.configuration?.interfaces.find((x) => x.interfaceNumber === n)
      if (i) (i as { claimed: boolean }).claimed = true
    },
    async releaseInterface() {
      setupCalls.push('releaseInterface')
    },
    async selectAlternateInterface() {
      await setup('selectAlternateInterface')
    },
    async transferOut(endpoint: number, data: BufferSource): Promise<USBOutTransferResult> {
      if (!opened) throw new DOMException('The device must be opened first.', 'InvalidStateError')
      if (endpoint !== BULK_OUT) throw new Error(`fake: transferOut on endpoint ${endpoint}`)
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
      outTransfers.push(bytes.length)
      if (bytes.length === 0) return { bytesWritten: 0, status: 'ok' } as USBOutTransferResult
      if (refusingData) {
        return new Promise((_, reject) => {
          hanging = { reject }
        })
      }
      if (incoming) {
        // More of a data-out phase.
        if (options.outDelayMs) await new Promise((r) => setTimeout(r, options.outDelayMs))
        const stallAt = options.stallDataAfterBytes
        if (stallAt !== undefined && incoming.bytes.length + bytes.length > stallAt) {
          return new Promise((_, reject) => {
            hanging = { reject }
          })
        }
        incoming.bytes.push(...bytes)
        if (incoming.length === undefined && incoming.bytes.length >= 12) {
          const header = decodeHeader(Uint8Array.from(incoming.bytes.slice(0, 12)))
          if (header.type !== ContainerType.Data) throw new Error(`fake: expected a data container, got type ${header.type}`)
          incoming.length = header.length
        }
        if (incoming.length !== undefined && incoming.bytes.length >= incoming.length) {
          const done = incoming
          incoming = null
          const payload = Uint8Array.from(done.bytes.slice(12, done.length))
          if (options.throwOn?.(done.op, done.params)) failRead()
          else if (!options.hangOn?.(done.op, done.params)) {
            const delay = options.answerDelayMs?.(done.op) ?? 0
            if (delay > 0) setTimeout(() => handleData(done.op, done.tid, done.params, payload), delay)
            else handleData(done.op, done.tid, done.params, payload)
          }
        }
        return { bytesWritten: bytes.length, status: 'ok' } as USBOutTransferResult
      }
      const c = decodeContainer(bytes)
      if (c.type !== ContainerType.Command) throw new Error(`fake: unexpected container type ${c.type}`)
      sentOperations.push(c.code)
      const early = c.code === 0x100c || c.code === 0x100d ? options.answerBeforeData?.(c.code) : undefined
      if (early !== undefined) {
        respond(early, c.transactionId)
        refusingData = true
      } else if (c.code === 0x100c || c.code === 0x100d) {
        // The data-out phase follows in the next transfers.
        incoming = { op: c.code, tid: c.transactionId, params: c.params, bytes: [] }
      } else if (options.throwOn?.(c.code, c.params)) {
        throwNextRead = true
      } else if (!options.hangOn?.(c.code, c.params)) {
        handle(c.code, c.transactionId, c.params)
      }
      return { bytesWritten: bytes.length, status: 'ok' } as USBOutTransferResult
    },
    async clearHalt(direction: USBDirection, endpoint: number): Promise<void> {
      clearHalts.push(`${direction} ${endpoint}`)
      if (direction === 'in' && endpoint === INTERRUPT_IN) interruptStalled = false
    },
    async controlTransferIn(setup: USBControlTransferParameters): Promise<USBInTransferResult> {
      controlRequests.push({ request: setup.request, data: [] })
      if (options.controlFails) throw new DOMException('A transfer error has occurred.', 'NetworkError')
      const status = options.deviceStatus ?? ResponseCode.OK
      const bytes = Uint8Array.from([4, 0, status & 0xff, status >> 8])
      return { data: dataView(bytes), status: 'ok' } as USBInTransferResult
    },
    async controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource): Promise<USBOutTransferResult> {
      const bytes = data ? Array.from(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)) : []
      controlRequests.push({ request: setup.request, data: bytes })
      if (options.controlFails) throw new DOMException('A transfer error has occurred.', 'NetworkError')
      return { bytesWritten: bytes.length, status: 'ok' } as USBOutTransferResult
    },
    async transferIn(endpoint: number, length: number): Promise<USBInTransferResult> {
      if (!opened) throw new DOMException('The device must be opened first.', 'InvalidStateError')
      if (endpoint === INTERRUPT_IN) {
        interruptReads++
        if (interruptStalled) {
          // A real transfer completes asynchronously, a macrotask later.
          await new Promise((r) => setTimeout(r, 0))
          return { data: undefined, status: 'stall' } as USBInTransferResult
        }
        if (events.length === 0) {
          await new Promise<void>((resolve, reject) => eventReaders.push({ resolve, reject }))
        }
        const ev = events.shift()!
        ev.release?.()
        return { data: dataView(ev.bytes), status: 'ok' } as USBInTransferResult
      }
      if (endpoint !== BULK_IN) throw new Error(`fake: transferIn on endpoint ${endpoint}`)
      if (throwNextRead) {
        throwNextRead = false
        throw new DOMException('A transfer error has occurred.', 'NetworkError')
      }
      if (packets.length === 0) {
        // Nothing queued: a real device leaves the read pending until it has something to
        // send (a slow answer), or forever (a transport that over-reads hangs here and the
        // session's timeout fires). Closing the device rejects it.
        await new Promise<void>((resolve, reject) => {
          hanging = { reject }
          waitingRead = resolve
        })
        hanging = null
      }
      const out: number[] = []
      const limit = Math.min(length, options.maxTransferBytes ?? Infinity)
      while (packets.length > 0 && out.length < limit) {
        const p = packets.shift()!
        out.push(...p)
        if (p.length < packetSize) break
      }
      if (out.length > limit) {
        // Hand back only `limit` bytes; requeue the rest of the packet.
        packets.unshift(Uint8Array.from(out.splice(limit)))
      }
      if (out.length === 0) emptyTransfers++
      const bytes = Uint8Array.from(out)
      return { data: dataView(bytes), status: 'ok' } as USBInTransferResult
    },
  }

  return {
    device: device as unknown as USBDevice,
    sentOperations,
    setupCalls,
    get opened() {
      return opened
    },
    get interruptReads() {
      return interruptReads
    },
    clearHalts,
    get emptyTransfers() {
      return emptyTransfers
    },
    objects,
    outTransfers,
    objectInfos,
    controlRequests,
    get pendingEventReads() {
      return eventReaders.length
    },
  }
}

// WebUSB transport for MTP: finds a device's MTP interface, opens and claims it,
// and moves containers over its bulk endpoints. Protocol-level operations (transaction
// ids, response codes, timeouts) live in session.ts.

import { ContainerType, HEADER_SIZE, decodeContainer, decodeHeader, encodeContainer, type Container } from './container.js'

// Each bulk IN read asks for this much. Conservative for Android's USB stack; a read
// still ends early on a short packet.
export const DEFAULT_READ_SIZE = 16 * 1024

// Each bulk OUT write of a data phase carries at most this much, so progress can be reported.
export const WRITE_CHUNK_SIZE = 64 * 1024

export interface MtpInterfaceChoice {
  configurationValue: number
  interfaceNumber: number
  alternateSetting: number
  interfaceClass: number
  bulkIn: number
  bulkOut: number
  interruptIn: number
  // Bulk IN max packet size.
  packetSize: number
  // Bulk OUT max packet size: a data phase that fills its last packet exactly ends with a ZLP.
  outPacketSize: number
  // Why this one was chosen, for the log.
  reason: string
}

const STILL_IMAGE = 0x06
const VENDOR_SPECIFIC = 0xff

function hex2(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(2, '0')}`
}

// An MTP interface is an alternate setting of class 0x06 (still image, the PTP/MTP class)
// or 0xFF (vendor-specific, used by some MTP devices) with bulk IN, bulk OUT and interrupt IN
// endpoints. 0x06 wins, then the lowest interface number.
export function findMtpInterface(device: USBDevice): MtpInterfaceChoice | null {
  const candidates: MtpInterfaceChoice[] = []
  for (const config of device.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass !== STILL_IMAGE && alt.interfaceClass !== VENDOR_SPECIFIC) continue
        const find = (direction: USBDirection, type: USBEndpointType) =>
          alt.endpoints.find((e) => e.direction === direction && e.type === type)
        const bulkIn = find('in', 'bulk')
        const bulkOut = find('out', 'bulk')
        const interruptIn = find('in', 'interrupt')
        if (!bulkIn || !bulkOut || !interruptIn) continue
        candidates.push({
          configurationValue: config.configurationValue,
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alt.alternateSetting,
          interfaceClass: alt.interfaceClass,
          bulkIn: bulkIn.endpointNumber,
          bulkOut: bulkOut.endpointNumber,
          interruptIn: interruptIn.endpointNumber,
          packetSize: bulkIn.packetSize,
          outPacketSize: bulkOut.packetSize,
          reason: '',
        })
      }
    }
  }
  if (candidates.length === 0) return null
  candidates.sort(
    (a, b) =>
      Number(b.interfaceClass === STILL_IMAGE) - Number(a.interfaceClass === STILL_IMAGE) ||
      a.interfaceNumber - b.interfaceNumber,
  )
  const choice = candidates[0]
  const kind = choice.interfaceClass === STILL_IMAGE ? 'still image' : 'vendor-specific'
  choice.reason =
    `class ${hex2(choice.interfaceClass)} (${kind}) with bulk IN, bulk OUT and interrupt IN endpoints` +
    (candidates.length > 1 ? `; preferred over ${candidates.length - 1} other candidate(s)` : '')
  return choice
}

export type SetupStep = 'open' | 'selectConfiguration' | 'claimInterface' | 'selectAlternateInterface'

// Setup calls get the same budget as MTP operations (session.ts OPERATION_TIMEOUT_MS).
export const SETUP_TIMEOUT_MS = 10_000

// A WebUSB setup call failed or never completed. `step` lets the caller explain the likely
// cause; `timedOut` tells a hang from an error.
export class UsbSetupError extends Error {
  constructor(
    readonly step: SetupStep,
    readonly cause: unknown,
    readonly timedOut = false,
  ) {
    super(`${step} failed: ${describeError(cause)}`)
    this.name = 'UsbSetupError'
  }
}

export function describeError(e: unknown): string {
  if (e instanceof Error) return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message
  return String(e)
}

// How long the event loop waits after clearing a stalled interrupt endpoint.
const EVENT_RETRY_MS = 20

export class MtpTransport {
  // Bytes read past the end of the last container (a data phase and its response can
  // arrive in one transfer when the data is an exact multiple of the packet size and the
  // device sends no zero-length packet).
  private pending = new Uint8Array(0)
  // Set once the transport is closing, so the event loop stops instead of reading again.
  private stopped = false

  constructor(
    readonly device: USBDevice,
    readonly choice: MtpInterfaceChoice,
    private readonly readSize = DEFAULT_READ_SIZE,
    private readonly setupTimeoutMs = SETUP_TIMEOUT_MS,
  ) {}

  async setup(onStep: (message: string) => void = () => {}): Promise<void> {
    const { device, choice } = this
    await this.run('open', () => device.open())
    onStep('Opened the device')
    if (device.configuration?.configurationValue === choice.configurationValue) {
      onStep(`Configuration ${choice.configurationValue} already active`)
    } else {
      await this.run('selectConfiguration', () => device.selectConfiguration(choice.configurationValue))
      onStep(`Selected configuration ${choice.configurationValue}`)
    }
    await this.run('claimInterface', () => device.claimInterface(choice.interfaceNumber))
    onStep(`Claimed interface ${choice.interfaceNumber}`)
    if (choice.alternateSetting !== 0) {
      await this.run('selectAlternateInterface', () =>
        device.selectAlternateInterface(choice.interfaceNumber, choice.alternateSetting),
      )
      onStep(`Selected alternate setting ${choice.alternateSetting}`)
    }
  }

  // Run one setup call against the timeout. A hang (plausible while another app holds the
  // device) closes the device, which is the only way to cancel the call.
  private async run(step: SetupStep, call: () => Promise<void>): Promise<void> {
    const attempt = call()
    attempt.catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.setupTimeoutMs)
    })
    try {
      const outcome = await Promise.race([attempt, timeout])
      if (outcome === 'timeout') {
        await this.abort()
        throw new UsbSetupError(step, new Error(`no answer within ${this.setupTimeoutMs / 1000} s`), true)
      }
    } catch (e) {
      if (e instanceof UsbSetupError) throw e
      throw new UsbSetupError(step, e)
    } finally {
      clearTimeout(timer)
    }
  }

  async sendCommand(code: number, transactionId: number, params: number[]): Promise<void> {
    await this.write(encodeContainer({ type: ContainerType.Command, code, transactionId, params }))
  }

  // Write one data container (the data-out phase of a command): its 12-byte header in a transfer
  // of its own, then the payload in WRITE_CHUNK_SIZE pieces, calling onProgress(bytesSent,
  // totalBytes) after each, and a zero-length packet when the payload fills its last bulk OUT
  // packet exactly. The header goes alone because some devices read a data phase as "header,
  // then payload" and lose a payload that arrives in the header's packet (one such device
  // accepted SendObjectInfo's single packet and never answered).
  async sendData(
    code: number,
    transactionId: number,
    payload: Uint8Array,
    onProgress: (sent: number, total: number) => void = () => {},
  ): Promise<void> {
    const bytes = encodeContainer({ type: ContainerType.Data, code, transactionId, payload })
    await this.write(bytes.subarray(0, HEADER_SIZE))
    onProgress(HEADER_SIZE, bytes.length)
    for (let sent = HEADER_SIZE; sent < bytes.length; ) {
      const chunk = bytes.subarray(sent, Math.min(sent + WRITE_CHUNK_SIZE, bytes.length))
      await this.write(chunk)
      sent += chunk.length
      onProgress(sent, bytes.length)
    }
    if (payload.length > 0 && payload.length % this.choice.outPacketSize === 0) await this.write(new Uint8Array(0))
  }

  private async write(bytes: Uint8Array): Promise<void> {
    const result = await this.device.transferOut(this.choice.bulkOut, bytes as BufferSource)
    if (result.status !== 'ok') throw new Error(`Bulk OUT transfer ended with status "${result.status}"`)
  }

  // Read one whole container: skip zero-length transfers before it, then keep reading
  // until the header's length has arrived. Never waits for a trailing ZLP.
  async readContainer(): Promise<Container> {
    let buffer = this.pending
    while (buffer.length < HEADER_SIZE) {
      buffer = concat(buffer, await this.readChunk())
    }
    const { length } = decodeHeader(buffer)
    if (length < HEADER_SIZE) throw new Error(`MTP container claims an impossible length (${length})`)
    while (buffer.length < length) {
      buffer = concat(buffer, await this.readChunk())
    }
    this.pending = buffer.slice(length)
    return decodeContainer(buffer.subarray(0, length))
  }

  private async readChunk(): Promise<Uint8Array> {
    const result = await this.device.transferIn(this.choice.bulkIn, this.readSize)
    if (result.status !== 'ok') throw new Error(`Bulk IN transfer ended with status "${result.status}"`)
    const view = result.data
    return view ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength) : new Uint8Array(0)
  }

  // Keep reading the interrupt endpoint and pass each MTP event on, until the device is closed.
  // Some devices hold an operation's answer until its event has been read (one took
  // SendObjectInfo's data and never answered while nobody read events).
  startEvents(onEvent: (event: Container) => void): void {
    const loop = async () => {
      while (!this.stopped) {
        let result: USBInTransferResult
        try {
          result = await this.device.transferIn(this.choice.interruptIn, 64)
        } catch {
          return // closed or disconnected
        }
        if (result.status === 'stall') {
          // A stalled endpoint answers every read at once: clear it and wait a moment, rather
          // than sending reads back to back for the whole connection.
          try {
            await this.device.clearHalt('in', this.choice.interruptIn)
          } catch {
            return // closed or disconnected
          }
          await new Promise((r) => setTimeout(r, EVENT_RETRY_MS))
          continue
        }
        const view = result.data
        if (result.status !== 'ok' || !view || view.byteLength < HEADER_SIZE) continue
        try {
          onEvent(decodeContainer(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)))
        } catch {
          // A malformed event is skipped; the next read goes on.
        }
      }
    }
    void loop()
  }

  // MTP's USB class request GetDeviceStatus (0x67): the device's own view of its state, as a
  // response code (OK, DeviceBusy, TransactionCancelled, …). Sent on the control endpoint, so it
  // works while a bulk transfer is stuck.
  async getDeviceStatus(): Promise<number> {
    const result = await this.device.controlTransferIn(
      { requestType: 'class', recipient: 'interface', request: 0x67, value: 0, index: this.choice.interfaceNumber },
      32,
    )
    const view = result.data
    if (result.status !== 'ok' || !view || view.byteLength < 4) throw new Error('GetDeviceStatus returned no status')
    return view.getUint16(2, true)
  }

  // MTP's USB class request Cancel (0x64) for one transaction: cancellation code 0x4001 and
  // the transaction id, little-endian.
  async cancelTransaction(transactionId: number): Promise<void> {
    const data = new Uint8Array(6)
    const view = new DataView(data.buffer)
    view.setUint16(0, 0x4001, true)
    view.setUint32(2, transactionId >>> 0, true)
    await this.device.controlTransferOut(
      { requestType: 'class', recipient: 'interface', request: 0x64, value: 0, index: this.choice.interfaceNumber },
      data as BufferSource,
    )
  }

  // Abandon the device after a thrown transfer or a timeout: closing is the only way WebUSB
  // cancels a pending transfer. No release first, which could wait on that transfer.
  async abort(): Promise<void> {
    this.stopped = true
    this.pending = new Uint8Array(0)
    try {
      await this.device.close()
    } catch {
      // Already closed or disconnected.
    }
  }

  // Release the interface and close the device. Best effort: never throws, since it runs
  // on every exit path, including after the device has gone away.
  async close(): Promise<void> {
    this.stopped = true
    this.pending = new Uint8Array(0)
    if (!this.device.opened) return
    try {
      await this.device.releaseInterface(this.choice.interfaceNumber)
    } catch {
      // The interface may never have been claimed.
    }
    try {
      await this.device.close()
    } catch {
      // Already closed or disconnected.
    }
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

// MTP operations over a claimed transport: transaction ids, data phases, response codes
// and per-operation timeouts.
//
// Two kinds of failure, handled differently by callers:
// - MtpResponseError: the device answered with a non-OK code. The pipe is fine, so later
//   operations (and CloseSession) can still be sent.
// - anything thrown by a transfer, or MtpTimeoutError: the pipe's state is unknown. The
//   session marks itself `broken`, closes the device (the only way WebUSB cancels a
//   pending transfer) and refuses further operations.

import { ContainerType, OperationCode, ResponseCode, formatCode, operationName, responseName, type Container } from './container.js'
import {
  decodeDeviceInfo,
  decodeObjectHandles,
  decodeObjectInfo,
  decodeStorageIds,
  decodeStorageInfo,
  encodeObjectInfo,
  type DeviceInfo,
  type ObjectInfoInput,
  type ObjectInfo,
  type StorageInfo,
} from './dataset.js'
import type { MtpTransport } from './transport.js'

export const OPERATION_TIMEOUT_MS = 10_000

// How long the device may take to answer a write (SendObjectInfo, or SendObject once its data
// has arrived). A device has been seen to take longer than 10 s to answer SendObjectInfo;
// desktop MTP stacks allow writes this order of time.
export const WRITE_ANSWER_TIMEOUT_MS = 60_000

// How long a data write may still take to complete after its answer has arrived before the
// answer counts as "early" (the device refused the data).
export const EARLY_ANSWER_GRACE_MS = 1_000

// GetObjectHandles' parent for "objects in the storage root" (0 would mean every object).
export const ROOT_PARENT = 0xffffffff

// `early`: the device answered a write before accepting its data, so it took none of it (even
// when the answer was OK).
export class MtpResponseError extends Error {
  constructor(
    readonly operation: number,
    readonly responseCode: number,
    readonly early = false,
  ) {
    super(
      early
        ? `${operationName(operation)} (${formatCode(operation)}) was answered ${responseName(responseCode)} (${formatCode(responseCode)}) before its data was accepted`
        : `${operationName(operation)} (${formatCode(operation)}) returned ${responseName(responseCode)} (${formatCode(responseCode)})`,
    )
    this.name = 'MtpResponseError'
  }
}

export class MtpTimeoutError extends Error {
  constructor(
    readonly operation: number,
    readonly timeoutMs: number,
  ) {
    super(`${operationName(operation)} (${formatCode(operation)}) got no answer within ${timeoutMs / 1000} s`)
    this.name = 'MtpTimeoutError'
  }
}

export interface OperationRecord {
  code: string
  name: string
  responseCode: string
  responseName: string
  // From sending the command to the response.
  elapsedMs: number
}

export interface MtpSessionOptions {
  timeoutMs?: number
  // The wait for the answer to a write; WRITE_ANSWER_TIMEOUT_MS by default.
  writeTimeoutMs?: number
  // Called after every operation the device answered (OK or not), for step logging.
  onOperation?: (op: OperationRecord) => void
  // Diagnostic notes (an early answer, the device status after a write timeout).
  onNote?: (text: string) => void
  // A data-out phase about to be written, and once the device has accepted all of it.
  onDataOut?: (code: number, payload: Uint8Array) => void
  onDataWritten?: (code: number, payload: Uint8Array) => void
}

interface DataOut {
  payload: Uint8Array
  onProgress?: (sent: number, total: number) => void
}

export interface SentObjectInfo {
  storageId: number
  parent: number
  handle: number
}

interface TransactionResult {
  data?: Uint8Array
  params: number[]
}

export class MtpSession {
  isOpen = false
  broken = false
  private nextTransactionId = 1
  private readonly timeoutMs: number
  private readonly writeTimeoutMs: number

  constructor(
    private readonly transport: MtpTransport,
    private readonly options: MtpSessionOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? OPERATION_TIMEOUT_MS
    this.writeTimeoutMs = options.writeTimeoutMs ?? WRITE_ANSWER_TIMEOUT_MS
  }

  private async transaction(
    code: number,
    params: number[] = [],
    transactionId?: number,
    dataOut?: DataOut,
    // For writes: how long the device may take to answer once the command (and data) are sent.
    answerTimeoutMs?: number,
  ): Promise<TransactionResult> {
    if (this.broken) throw new Error('The USB connection is broken; no further operations are sent')
    const tid = transactionId ?? this.nextTransactionId++
    // The timeout counts from the last sign of life: the start, or the latest data-out chunk.
    // So a long send only times out when it stalls, not because the file is large.
    let timer: ReturnType<typeof setTimeout> | undefined
    let expire: (e: Error) => void = () => {}
    const timeout = new Promise<never>((_, reject) => {
      expire = reject
    })
    const restartTimer = (ms = this.timeoutMs) => {
      clearTimeout(timer)
      timer = setTimeout(() => expire(new MtpTimeoutError(code, ms)), ms)
    }
    restartTimer()
    const started = Date.now()
    let answeredEarly = false
    const exchange = (async (): Promise<TransactionResult> => {
      await this.transport.sendCommand(code, tid, params)
      let container: Container
      if (dataOut) {
        // Read the answer while the data is written: a device that answers right after the
        // command (refusing the operation) won't take the data, and a sequential write would
        // block before the answer is ever read.
        const answer = this.transport.readContainer()
        answer.catch(() => {})
        this.options.onDataOut?.(code, dataOut.payload)
        const written = this.transport
          .sendData(code, tid, dataOut.payload, (sent, total) => {
            restartTimer()
            dataOut.onProgress?.(sent, total)
          })
          .then(() => null)
        let first = await Promise.race([written, answer])
        if (first) {
          // An answer right after the last data packet can resolve before the write does: give
          // the write a moment before calling the answer early. The answer is in, so the
          // operation's timeout no longer applies.
          clearTimeout(timer)
          const settled = await Promise.race([
            written.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), EARLY_ANSWER_GRACE_MS)),
          ])
          if (settled) first = null
        }
        if (first) {
          answeredEarly = true
          this.options.onNote?.(
            `The device answered before accepting the data of ${operationName(code)}: ${responseName(first.code)} (${formatCode(first.code)})`,
          )
          container = first
        } else {
          this.options.onDataWritten?.(code, dataOut.payload)
          if (answerTimeoutMs !== undefined) restartTimer(answerTimeoutMs)
          container = await answer
        }
      } else {
        if (answerTimeoutMs !== undefined) restartTimer(answerTimeoutMs)
        container = await this.transport.readContainer()
      }
      let data: Uint8Array | undefined
      if (container.type === ContainerType.Data && !dataOut) {
        data = container.payload
        container = await this.transport.readContainer()
      }
      if (container.type !== ContainerType.Response) {
        throw new Error(`Expected a response to ${operationName(code)}, got container type ${container.type}`)
      }
      this.options.onOperation?.({
        code: formatCode(code),
        name: operationName(code),
        responseCode: formatCode(container.code),
        responseName: responseName(container.code),
        elapsedMs: Date.now() - started,
      })
      if (answeredEarly) {
        // The data-out transfer is still pending on a device that won't take it: the pipe is
        // unusable, whatever the answer was.
        this.broken = true
        this.isOpen = false
        await this.transport.abort()
        throw new MtpResponseError(code, container.code, true)
      }
      if (container.code !== ResponseCode.OK) throw new MtpResponseError(code, container.code)
      return { data, params: container.params }
    })()

    // After a timeout the exchange still rejects once the device is closed; nobody awaits
    // it then, so swallow that rejection here.
    exchange.catch(() => {})
    try {
      return await Promise.race([exchange, timeout])
    } catch (e) {
      if (e instanceof MtpTimeoutError && answerTimeoutMs !== undefined) await this.diagnoseStuckWrite(tid)
      if (!(e instanceof MtpResponseError) || this.broken) {
        this.broken = true
        this.isOpen = false
        await this.transport.abort()
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  // After a write got no answer: log the device's own status and cancel the transaction, so the
  // device isn't left mid-operation (one left that way stayed stuck for the next connection).
  // Control requests, each with a short time limit; failures are noted, never thrown.
  private async diagnoseStuckWrite(tid: number): Promise<void> {
    // A throwing note callback must not stop the caller from closing the stuck pipe.
    const note = (t: string) => {
      try {
        this.options.onNote?.(t)
      } catch {
        // Ignored: the timeout is what gets reported.
      }
    }
    const limit = <T>(p: Promise<T>) =>
      Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no answer')), 2_000))])
    try {
      const status = await limit(this.transport.getDeviceStatus())
      note(`MTP status: ${responseName(status)} (${formatCode(status)})`)
    } catch (e) {
      note(`MTP status couldn't be read: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      await limit(this.transport.cancelTransaction(tid))
      note(`Asked the device to cancel transaction ${tid}`)
    } catch (e) {
      note(`Couldn't ask the device to cancel the transaction: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async dataOf(code: number, params: number[] = [], transactionId?: number): Promise<Uint8Array> {
    const { data } = await this.transaction(code, params, transactionId)
    if (!data) throw new Error(`${operationName(code)} returned no data`)
    return data
  }

  // Allowed outside a session; transaction id 0 by convention.
  async getDeviceInfo(): Promise<DeviceInfo> {
    return decodeDeviceInfo(await this.dataOf(OperationCode.GetDeviceInfo, [], 0))
  }

  async openSession(sessionId = 1): Promise<void> {
    await this.transaction(OperationCode.OpenSession, [sessionId], 0)
    this.nextTransactionId = 1
    this.isOpen = true
  }

  async closeSession(): Promise<void> {
    try {
      await this.transaction(OperationCode.CloseSession)
    } finally {
      this.isOpen = false
    }
  }

  async getStorageIds(): Promise<number[]> {
    return decodeStorageIds(await this.dataOf(OperationCode.GetStorageIDs))
  }

  async getStorageInfo(storageId: number): Promise<StorageInfo> {
    return decodeStorageInfo(await this.dataOf(OperationCode.GetStorageInfo, [storageId]))
  }

  // Handles of the objects directly in `parent` (the storage root by default), any format.
  async getObjectHandles(storageId: number, parent = ROOT_PARENT): Promise<number[]> {
    return decodeObjectHandles(await this.dataOf(OperationCode.GetObjectHandles, [storageId, 0, parent]))
  }

  async getObjectInfo(handle: number): Promise<ObjectInfo> {
    return decodeObjectInfo(await this.dataOf(OperationCode.GetObjectInfo, [handle]))
  }

  // Announce a new object in `parent` (a folder handle). The device answers with where it
  // will store it; the following sendObject delivers its bytes.
  async sendObjectInfo(storageId: number, parent: number, info: ObjectInfoInput): Promise<SentObjectInfo> {
    const { params } = await this.transaction(
      OperationCode.SendObjectInfo,
      [storageId, parent],
      undefined,
      { payload: encodeObjectInfo(info) },
      this.writeTimeoutMs,
    )
    return { storageId: params[0], parent: params[1], handle: params[2] }
  }

  // The bytes of the object announced by the last sendObjectInfo. onProgress gets the
  // container bytes written so far and in total.
  async sendObject(bytes: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void> {
    await this.transaction(OperationCode.SendObject, [], undefined, { payload: bytes, onProgress }, this.writeTimeoutMs)
  }

  async deleteObject(handle: number): Promise<void> {
    await this.transaction(OperationCode.DeleteObject, [handle])
  }

  // Read `length` bytes from `offset` without fetching the whole object.
  async getPartialObject(handle: number, offset: number, length: number): Promise<Uint8Array> {
    const { data } = await this.transaction(OperationCode.GetPartialObject, [handle, offset, length])
    return data ?? new Uint8Array(0)
  }
}

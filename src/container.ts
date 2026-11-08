// MTP container framing. Every MTP message over USB bulk endpoints is a container:
// a 12-byte little-endian header (u32 length, u16 type, u16 code, u32 transaction id)
// followed by up to five u32 params (command/response) or a raw payload (data).
// Pure and DOM-free, so it's unit-tested in node; the WebUSB side is transport.ts.

export const HEADER_SIZE = 12
export const MAX_PARAMS = 5

export const ContainerType = {
  Command: 1,
  Data: 2,
  Response: 3,
  Event: 4,
} as const

// The operations the session uses. GetPartialObject (0x101B) reads part of an object,
// such as a file's header, without fetching a file that may be several GB.
export const OperationCode = {
  GetDeviceInfo: 0x1001,
  OpenSession: 0x1002,
  CloseSession: 0x1003,
  GetStorageIDs: 0x1004,
  GetStorageInfo: 0x1005,
  GetNumObjects: 0x1006,
  GetObjectHandles: 0x1007,
  GetObjectInfo: 0x1008,
  GetObject: 0x1009,
  DeleteObject: 0x100b,
  SendObjectInfo: 0x100c,
  SendObject: 0x100d,
  GetPartialObject: 0x101b,
} as const

export const ResponseCode = {
  OK: 0x2001,
  GeneralError: 0x2002,
  SessionNotOpen: 0x2003,
  InvalidTransactionID: 0x2004,
  OperationNotSupported: 0x2005,
  ParameterNotSupported: 0x2006,
  IncompleteTransfer: 0x2007,
  InvalidStorageID: 0x2008,
  InvalidObjectHandle: 0x2009,
  StoreFull: 0x200c,
  ObjectWriteProtected: 0x200d,
  StoreReadOnly: 0x200e,
  AccessDenied: 0x200f,
  DeviceBusy: 0x2019,
  InvalidParentObject: 0x201a,
  InvalidParameter: 0x201d,
  SessionAlreadyOpen: 0x201e,
  TransactionCancelled: 0x201f,
} as const

// MTP events, sent on the interrupt endpoint.
export const EventCode = {
  CancelTransaction: 0x4001,
  ObjectAdded: 0x4002,
  ObjectRemoved: 0x4003,
  StoreAdded: 0x4004,
  StoreRemoved: 0x4005,
  DevicePropChanged: 0x4006,
  ObjectInfoChanged: 0x4007,
  DeviceInfoChanged: 0x4008,
  StoreFull: 0x400a,
  StorageInfoChanged: 0x400c,
  ObjectPropChanged: 0xc801,
} as const

// ObjectFormat codes the session uses. An Association is a folder.
export const ObjectFormat = {
  Undefined: 0x3000,
  Association: 0x3001,
} as const

export interface ContainerHeader {
  length: number
  type: number
  code: number
  transactionId: number
}

export interface Container extends ContainerHeader {
  // u32 params for command, response and event containers; empty for data payloads.
  params: number[]
  // Everything after the header.
  payload: Uint8Array
}

export interface ContainerInput {
  type: number
  code: number
  transactionId: number
  params?: number[]
  payload?: Uint8Array
}

export function encodeContainer({ type, code, transactionId, params = [], payload }: ContainerInput): Uint8Array {
  if (params.length > MAX_PARAMS) {
    throw new Error(`An MTP container carries at most ${MAX_PARAMS} params, got ${params.length}`)
  }
  const bodyLength = payload ? payload.length : params.length * 4
  const bytes = new Uint8Array(HEADER_SIZE + bodyLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length, true)
  view.setUint16(4, type, true)
  view.setUint16(6, code, true)
  view.setUint32(8, transactionId >>> 0, true)
  if (payload) {
    bytes.set(payload, HEADER_SIZE)
  } else {
    params.forEach((p, i) => view.setUint32(HEADER_SIZE + i * 4, p >>> 0, true))
  }
  return bytes
}

export function decodeHeader(bytes: Uint8Array): ContainerHeader {
  if (bytes.length < HEADER_SIZE) {
    throw new Error(`MTP container header needs ${HEADER_SIZE} bytes, got ${bytes.length}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    length: view.getUint32(0, true),
    type: view.getUint16(4, true),
    code: view.getUint16(6, true),
    transactionId: view.getUint32(8, true),
  }
}

export function decodeContainer(bytes: Uint8Array): Container {
  const header = decodeHeader(bytes)
  if (bytes.length < header.length) {
    throw new Error(`MTP container truncated: header says ${header.length} bytes, got ${bytes.length}`)
  }
  const payload = bytes.slice(HEADER_SIZE, header.length)
  const params: number[] = []
  if (header.type === ContainerType.Command || header.type === ContainerType.Response || header.type === ContainerType.Event) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    for (let i = 0; i + 4 <= payload.length && params.length < MAX_PARAMS; i += 4) {
      params.push(view.getUint32(i, true))
    }
  }
  return { ...header, params, payload }
}

function nameOf(table: Record<string, number>, code: number): string | undefined {
  return Object.keys(table).find((k) => table[k] === code)
}

export function operationName(code: number): string {
  return nameOf(OperationCode, code) ?? 'Unknown operation'
}

export function eventName(code: number): string {
  return nameOf(EventCode, code) ?? 'Unknown event'
}

export function responseName(code: number): string {
  return nameOf(ResponseCode, code) ?? 'Unknown response'
}

// 0x101B style: upper-case hex, at least four digits.
export function formatCode(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(4, '0')}`
}

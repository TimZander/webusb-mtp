// Spec: mtp-codec › "Containers are encoded little-endian", "Containers are decoded whole or
// refused", "Codes have readable names".
import { describe, it, expect } from 'vitest'
import {
  ContainerType,
  HEADER_SIZE,
  OperationCode,
  ResponseCode,
  decodeContainer,
  decodeHeader,
  encodeContainer,
  eventName,
  formatCode,
  operationName,
  responseName,
} from '../src/container.js'

describe('encodeContainer', () => {
  it('writes a little-endian command header followed by its params', () => {
    const bytes = encodeContainer({
      type: ContainerType.Command,
      code: OperationCode.GetStorageInfo,
      transactionId: 0x01020304,
      params: [0x00010001],
    })
    expect(bytes.length).toBe(HEADER_SIZE + 4)
    expect(Array.from(bytes)).toEqual([
      16, 0, 0, 0, // length
      1, 0, // type: command
      0x05, 0x10, // code 0x1005
      0x04, 0x03, 0x02, 0x01, // transaction id
      0x01, 0x00, 0x01, 0x00, // param 1
    ])
  })

  it('accepts up to five params and rejects more', () => {
    const five = encodeContainer({ type: ContainerType.Command, code: 0x1001, transactionId: 1, params: [1, 2, 3, 4, 5] })
    expect(five.length).toBe(HEADER_SIZE + 20)
    expect(() =>
      encodeContainer({ type: ContainerType.Command, code: 0x1001, transactionId: 1, params: [1, 2, 3, 4, 5, 6] }),
    ).toThrow(/at most 5/)
  })

  it('writes a data container with its payload', () => {
    const bytes = encodeContainer({
      type: ContainerType.Data,
      code: 0x1001,
      transactionId: 7,
      payload: new Uint8Array([9, 8, 7]),
    })
    expect(decodeHeader(bytes)).toEqual({ length: 15, type: ContainerType.Data, code: 0x1001, transactionId: 7 })
    expect(Array.from(bytes.subarray(HEADER_SIZE))).toEqual([9, 8, 7])
  })
})

describe('decodeContainer', () => {
  it('round-trips a response and reads its params', () => {
    const bytes = encodeContainer({
      type: ContainerType.Response,
      code: ResponseCode.OK,
      transactionId: 3,
      params: [0xffffffff, 2],
    })
    const c = decodeContainer(bytes)
    expect(c.type).toBe(ContainerType.Response)
    expect(c.code).toBe(0x2001)
    expect(c.transactionId).toBe(3)
    expect(c.params).toEqual([0xffffffff, 2])
  })

  it('leaves a data payload whole and reports no params', () => {
    const payload = new Uint8Array(40).map((_, i) => i)
    const c = decodeContainer(encodeContainer({ type: ContainerType.Data, code: 0x1007, transactionId: 1, payload }))
    expect(c.params).toEqual([])
    expect(Array.from(c.payload)).toEqual(Array.from(payload))
  })

  it('rejects a buffer shorter than its header says', () => {
    const bytes = encodeContainer({ type: ContainerType.Response, code: 0x2001, transactionId: 1, params: [1] })
    expect(() => decodeContainer(bytes.subarray(0, 14))).toThrow(/truncated/)
  })

  it('rejects a buffer shorter than a header', () => {
    expect(() => decodeHeader(new Uint8Array(8))).toThrow(/header/)
  })
})

describe('code names', () => {
  it('names operations and responses with their hex code', () => {
    expect(operationName(0x1001)).toBe('GetDeviceInfo')
    expect(operationName(0x101b)).toBe('GetPartialObject')
    expect(operationName(0x9999)).toBe('Unknown operation')
    expect(responseName(0x2001)).toBe('OK')
    expect(responseName(0x2003)).toBe('SessionNotOpen')
    expect(responseName(0x2fff)).toBe('Unknown response')
    expect(formatCode(0x101b)).toBe('0x101B')
    expect(formatCode(0x67)).toBe('0x0067')
  })
})

describe('events', () => {
  it('decodes an event container with its params and names it', () => {
    const c = decodeContainer(encodeContainer({ type: ContainerType.Event, code: 0x4002, transactionId: 0, params: [0x01000074] }))
    expect(c.params).toEqual([0x01000074])
    expect(eventName(0x4002)).toBe('ObjectAdded')
    expect(eventName(0x4fff)).toBe('Unknown event')
  })
})

describe('spec scenarios (mtp-codec)', () => {
  it('encodes a command with three params as 24 little-endian bytes', () => {
    const bytes = encodeContainer({ type: ContainerType.Command, code: 0x1007, transactionId: 5, params: [1, 0, 0xffffffff] })
    expect(Array.from(bytes)).toEqual([24, 0, 0, 0, 1, 0, 0x07, 0x10, 5, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff])
  })

  it('refuses six params, naming the limit', () => {
    expect(() =>
      encodeContainer({ type: ContainerType.Command, code: 0x1001, transactionId: 1, params: [1, 2, 3, 4, 5, 6] }),
    ).toThrow(/at most 5 params/)
  })

  it('decodes a response with params 7 and 8', () => {
    const c = decodeContainer(encodeContainer({ type: ContainerType.Response, code: 0x2001, transactionId: 1, params: [7, 8] }))
    expect([c.type, c.code, c.params]).toEqual([3, 0x2001, [7, 8]])
  })

  it('keeps an eight-byte data payload whole with no params', () => {
    const payload = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0])
    const c = decodeContainer(encodeContainer({ type: ContainerType.Data, code: 0x1004, transactionId: 1, payload }))
    expect(c.params).toEqual([])
    expect(Array.from(c.payload)).toEqual(Array.from(payload))
  })

  it('refuses a buffer holding 16 of the 20 bytes its header states', () => {
    const bytes = encodeContainer({ type: ContainerType.Response, code: 0x2001, transactionId: 1, params: [1, 2] })
    expect(decodeHeader(bytes).length).toBe(20)
    expect(() => decodeContainer(bytes.subarray(0, 16))).toThrow(/truncated/)
  })

  it('names known and unknown codes', () => {
    expect([operationName(0x1004), responseName(0x2002), operationName(0x9999)]).toEqual([
      'GetStorageIDs',
      'GeneralError',
      'Unknown operation',
    ])
  })
})

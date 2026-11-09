// MTP dataset encoding: the little-endian structures carried in data containers —
// DeviceInfo, StorageInfo, ObjectInfo, arrays, and MTP strings (a u8 character count
// including the NUL terminator, then UTF-16LE; an empty string is a single 0 byte).
// Pure and DOM-free.

import { ObjectFormat } from './container.js'

export class DataReader {
  offset = 0
  private readonly view: DataView

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private need(n: number): void {
    if (this.offset + n > this.bytes.length) {
      throw new Error(`MTP dataset: read of ${n} bytes at ${this.offset} runs past the end (${this.bytes.length})`)
    }
  }

  u8(): number {
    this.need(1)
    return this.view.getUint8(this.offset++)
  }

  u16(): number {
    this.need(2)
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }

  u32(): number {
    this.need(4)
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  // Storage sizes are u64; as a number they're exact up to 2^53 (8 PB), plenty here.
  u64(): number {
    const low = this.u32()
    const high = this.u32()
    return high * 0x1_0000_0000 + low
  }

  string(): string {
    const count = this.u8()
    if (count === 0) return ''
    this.need(count * 2)
    let text = ''
    for (let i = 0; i < count; i++) {
      const unit = this.view.getUint16(this.offset + i * 2, true)
      if (unit === 0) break
      text += String.fromCharCode(unit)
    }
    this.offset += count * 2
    return text
  }

  u16Array(): number[] {
    const n = this.u32()
    return Array.from({ length: n }, () => this.u16())
  }

  u32Array(): number[] {
    const n = this.u32()
    return Array.from({ length: n }, () => this.u32())
  }
}

export const MAX_STRING_LENGTH = 254

export class DataWriter {
  private parts: number[] = []

  u8(v: number): void {
    this.parts.push(v & 0xff)
  }

  u16(v: number): void {
    this.u8(v)
    this.u8(v >>> 8)
  }

  u32(v: number): void {
    for (let i = 0; i < 4; i++) this.u8(v >>> (i * 8))
  }

  u64(v: number): void {
    this.u32(v % 0x1_0000_0000)
    this.u32(Math.floor(v / 0x1_0000_0000))
  }

  // The u8 count includes the NUL terminator, so a string holds at most 254 UTF-16 units.
  string(text: string): void {
    if (text.length > MAX_STRING_LENGTH) {
      throw new Error(`An MTP string holds at most ${MAX_STRING_LENGTH} UTF-16 units, got ${text.length}`)
    }
    if (text === '') {
      this.u8(0)
      return
    }
    this.u8(text.length + 1)
    for (let i = 0; i < text.length; i++) this.u16(text.charCodeAt(i))
    this.u16(0)
  }

  u16Array(values: number[]): void {
    this.u32(values.length)
    values.forEach((v) => this.u16(v))
  }

  u32Array(values: number[]): void {
    this.u32(values.length)
    values.forEach((v) => this.u32(v))
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}

export interface DeviceInfo {
  standardVersion: number
  vendorExtensionId: number
  vendorExtensionVersion: number
  vendorExtensionDesc: string
  functionalMode: number
  operationsSupported: number[]
  eventsSupported: number[]
  devicePropertiesSupported: number[]
  captureFormats: number[]
  playbackFormats: number[]
  manufacturer: string
  model: string
  deviceVersion: string
  serialNumber: string
}

export function decodeDeviceInfo(bytes: Uint8Array): DeviceInfo {
  const r = new DataReader(bytes)
  return {
    standardVersion: r.u16(),
    vendorExtensionId: r.u32(),
    vendorExtensionVersion: r.u16(),
    vendorExtensionDesc: r.string(),
    functionalMode: r.u16(),
    operationsSupported: r.u16Array(),
    eventsSupported: r.u16Array(),
    devicePropertiesSupported: r.u16Array(),
    captureFormats: r.u16Array(),
    playbackFormats: r.u16Array(),
    manufacturer: r.string(),
    model: r.string(),
    deviceVersion: r.string(),
    serialNumber: r.string(),
  }
}

export interface StorageInfo {
  storageType: number
  filesystemType: number
  accessCapability: number
  maxCapacity: number
  freeSpaceInBytes: number
  freeSpaceInObjects: number
  storageDescription: string
  volumeLabel: string
}

export function decodeStorageInfo(bytes: Uint8Array): StorageInfo {
  const r = new DataReader(bytes)
  return {
    storageType: r.u16(),
    filesystemType: r.u16(),
    accessCapability: r.u16(),
    maxCapacity: r.u64(),
    freeSpaceInBytes: r.u64(),
    freeSpaceInObjects: r.u32(),
    storageDescription: r.string(),
    volumeLabel: r.string(),
  }
}

export function decodeStorageIds(bytes: Uint8Array): number[] {
  return new DataReader(bytes).u32Array()
}

export function decodeObjectHandles(bytes: Uint8Array): number[] {
  return new DataReader(bytes).u32Array()
}

export interface ObjectInfo {
  storageId: number
  objectFormat: number
  protectionStatus: number
  // 0xFFFFFFFF means the object is 4 GiB or larger (the real size needs an MTP property).
  objectCompressedSize: number
  parentObject: number
  associationType: number
  filename: string
  dateCreated: string
  dateModified: string
  isFolder: boolean
}

export function decodeObjectInfo(bytes: Uint8Array): ObjectInfo {
  const r = new DataReader(bytes)
  const storageId = r.u32()
  const objectFormat = r.u16()
  const protectionStatus = r.u16()
  const objectCompressedSize = r.u32()
  r.u16() // ThumbFormat
  r.u32() // ThumbCompressedSize
  r.u32() // ThumbPixWidth
  r.u32() // ThumbPixHeight
  r.u32() // ImagePixWidth
  r.u32() // ImagePixHeight
  r.u32() // ImageBitDepth
  const parentObject = r.u32()
  const associationType = r.u16()
  r.u32() // AssociationDesc
  r.u32() // SequenceNumber
  const filename = r.string()
  const dateCreated = r.string()
  const dateModified = r.string()
  return {
    storageId,
    objectFormat,
    protectionStatus,
    objectCompressedSize,
    parentObject,
    associationType,
    filename,
    dateCreated,
    dateModified,
    isFolder: objectFormat === ObjectFormat.Association,
  }
}

export interface ObjectInfoInput {
  storageId: number
  objectFormat: number
  objectCompressedSize: number
  parentObject: number
  associationType: number
  filename: string
  dateCreated?: string
  dateModified?: string
}

// The ObjectInfo dataset SendObjectInfo carries, and what a simulated device
// answers GetObjectInfo with in tests.
export function encodeObjectInfo(o: ObjectInfoInput): Uint8Array {
  const w = new DataWriter()
  w.u32(o.storageId)
  w.u16(o.objectFormat)
  w.u16(0) // ProtectionStatus
  w.u32(o.objectCompressedSize)
  w.u16(0) // ThumbFormat
  for (let i = 0; i < 6; i++) w.u32(0) // thumb size/width/height, image width/height/depth
  w.u32(o.parentObject)
  w.u16(o.associationType)
  w.u32(0) // AssociationDesc
  w.u32(0) // SequenceNumber
  w.string(o.filename)
  w.string(o.dateCreated ?? '')
  w.string(o.dateModified ?? '')
  w.string('') // Keywords
  return w.toBytes()
}

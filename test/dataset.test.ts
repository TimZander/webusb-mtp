// Spec: mtp-codec › "Dataset primitives follow MTP's encoding", "Standard datasets are decoded",
// "ObjectInfo is encoded for sending".
import { describe, it, expect } from 'vitest'
import {
  DataReader,
  DataWriter,
  decodeDeviceInfo,
  decodeObjectHandles,
  decodeObjectInfo,
  decodeStorageIds,
  decodeStorageInfo,
  encodeObjectInfo,
} from '../src/dataset.js'

describe('MTP strings', () => {
  it('decodes a length-prefixed UCS-2 string with its terminator', () => {
    // "Hi": 3 chars including the NUL terminator, then UTF-16LE.
    const r = new DataReader(new Uint8Array([3, 0x48, 0, 0x69, 0, 0, 0]))
    expect(r.string()).toBe('Hi')
    expect(r.offset).toBe(7)
  })

  it('decodes an empty string as a single zero byte', () => {
    const r = new DataReader(new Uint8Array([0]))
    expect(r.string()).toBe('')
    expect(r.offset).toBe(1)
  })

  it('round-trips non-ASCII text through the writer', () => {
    const w = new DataWriter()
    w.string('Gipfel – Höhe')
    expect(new DataReader(w.toBytes()).string()).toBe('Gipfel – Höhe')
  })

  it('throws when a read runs past the end', () => {
    expect(() => new DataReader(new Uint8Array([1, 2])).u32()).toThrow(/past the end/)
  })
})

describe('arrays and u64', () => {
  it('reads u16 and u32 arrays with a u32 count', () => {
    const w = new DataWriter()
    w.u16Array([0x1001, 0x101b])
    w.u32Array([7, 0xffffffff])
    const r = new DataReader(w.toBytes())
    expect(r.u16Array()).toEqual([0x1001, 0x101b])
    expect(r.u32Array()).toEqual([7, 0xffffffff])
  })

  it('reads a u64 above 2^32 as a number', () => {
    const w = new DataWriter()
    w.u64(32_000_000_000)
    expect(new DataReader(w.toBytes()).u64()).toBe(32_000_000_000)
  })
})

function deviceInfoBytes(): Uint8Array {
  const w = new DataWriter()
  w.u16(100) // StandardVersion
  w.u32(6) // VendorExtensionID
  w.u16(100) // VendorExtensionVersion
  w.string('microsoft.com: 1.0;')
  w.u16(0) // FunctionalMode
  w.u16Array([0x1001, 0x1002, 0x101b])
  w.u16Array([0x4002])
  w.u16Array([])
  w.u16Array([])
  w.u16Array([0x3000, 0x3001])
  w.string('Example Corp')
  w.string('Model X')
  w.string('15.08')
  w.string('ABC123')
  return w.toBytes()
}

describe('decodeDeviceInfo', () => {
  it('reads every DeviceInfo field', () => {
    const info = decodeDeviceInfo(deviceInfoBytes())
    expect(info.standardVersion).toBe(100)
    expect(info.vendorExtensionDesc).toBe('microsoft.com: 1.0;')
    expect(info.operationsSupported).toEqual([0x1001, 0x1002, 0x101b])
    expect(info.eventsSupported).toEqual([0x4002])
    expect(info.playbackFormats).toEqual([0x3000, 0x3001])
    expect(info.manufacturer).toBe('Example Corp')
    expect(info.model).toBe('Model X')
    expect(info.deviceVersion).toBe('15.08')
    expect(info.serialNumber).toBe('ABC123')
  })
})

describe('decodeStorageInfo', () => {
  it('reads capacity, free space and labels', () => {
    const w = new DataWriter()
    w.u16(3) // StorageType: fixed RAM
    w.u16(2) // FilesystemType: generic hierarchical
    w.u16(0) // AccessCapability: read-write
    w.u64(32_000_000_000)
    w.u64(12_500_000_000)
    w.u32(0xffffffff)
    w.string('Internal Storage')
    w.string('DATA')
    const s = decodeStorageInfo(w.toBytes())
    expect(s).toEqual({
      storageType: 3,
      filesystemType: 2,
      accessCapability: 0,
      maxCapacity: 32_000_000_000,
      freeSpaceInBytes: 12_500_000_000,
      freeSpaceInObjects: 0xffffffff,
      storageDescription: 'Internal Storage',
      volumeLabel: 'DATA',
    })
  })
})

describe('object handles and storage ids', () => {
  it('reads u32 arrays', () => {
    const w = new DataWriter()
    w.u32Array([0x00010001, 0x00020001])
    expect(decodeStorageIds(w.toBytes())).toEqual([0x00010001, 0x00020001])
    expect(decodeObjectHandles(w.toBytes())).toEqual([0x00010001, 0x00020001])
  })
})

describe('ObjectInfo', () => {
  it('round-trips through encodeObjectInfo', () => {
    const bytes = encodeObjectInfo({
      storageId: 0x00010001,
      objectFormat: 0x3000,
      objectCompressedSize: 523_264,
      parentObject: 0x10,
      associationType: 0,
      filename: 'a.bin',
      dateModified: '20261025T120000',
    })
    const info = decodeObjectInfo(bytes)
    expect(info.storageId).toBe(0x00010001)
    expect(info.objectFormat).toBe(0x3000)
    expect(info.objectCompressedSize).toBe(523_264)
    expect(info.parentObject).toBe(0x10)
    expect(info.filename).toBe('a.bin')
    expect(info.dateModified).toBe('20261025T120000')
    expect(info.isFolder).toBe(false)
  })

  it('marks an Association as a folder', () => {
    const info = decodeObjectInfo(
      encodeObjectInfo({ storageId: 1, objectFormat: 0x3001, objectCompressedSize: 0, parentObject: 0, associationType: 1, filename: 'DATA' }),
    )
    expect(info.isFolder).toBe(true)
  })
})

describe('spec scenarios (mtp-codec)', () => {
  it('round-trips Größe with a count of 6', () => {
    const w = new DataWriter()
    w.string('Größe')
    const bytes = w.toBytes()
    expect(bytes[0]).toBe(6)
    expect(new DataReader(bytes).string()).toBe('Größe')
  })

  it('writes an empty string as one zero byte', () => {
    const w = new DataWriter()
    w.string('')
    expect(Array.from(w.toBytes())).toEqual([0])
    expect(new DataReader(w.toBytes()).string()).toBe('')
  })

  it('refuses a string of 255 characters, naming the limit', () => {
    expect(() => new DataWriter().string('x'.repeat(255))).toThrow(/254/)
    expect(() => new DataWriter().string('x'.repeat(254))).not.toThrow()
  })

  it('reads a u64 of 5 * 2^32 + 7', () => {
    const r = new DataReader(new Uint8Array([7, 0, 0, 0, 5, 0, 0, 0]))
    expect(r.u64()).toBe(21474836487)
  })

  it('round-trips an ObjectInfo for a.bin', () => {
    const info = decodeObjectInfo(
      encodeObjectInfo({ storageId: 1, objectFormat: 0x3000, objectCompressedSize: 1234, parentObject: 7, associationType: 0, filename: 'a.bin' }),
    )
    expect(info).toMatchObject({ filename: 'a.bin', objectCompressedSize: 1234, parentObject: 7, objectFormat: 0x3000, isFolder: false })
  })
})

// Spec: mtp-transport › "WebUSB availability can be checked".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { webUsbAvailable } from '../src/webusb.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webUsbAvailable', () => {
  it('is false where there is no window', () => {
    expect(webUsbAvailable()).toBe(false)
  })

  it('is false in an insecure context, even with navigator.usb', () => {
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('navigator', { usb: {} })
    expect(webUsbAvailable()).toBe(false)
  })

  it('is true in a secure context with navigator.usb', () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { usb: {} })
    expect(webUsbAvailable()).toBe(true)
  })

  it('is false in a secure context without navigator.usb', () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', {})
    expect(webUsbAvailable()).toBe(false)
  })
})

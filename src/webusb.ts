// Whether WebUSB can be used here: it needs a secure context and a browser that has it
// (Chromium-based browsers; not Safari, iOS browsers or Firefox).
export function webUsbAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true && typeof navigator !== 'undefined' && 'usb' in navigator
}

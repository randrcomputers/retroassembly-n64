export type N64WasmBridge = {
  isReady?: () => boolean
  isRunning?: () => boolean
  getRomName?: () => string
  loadRomUrl: (url: string, title?: string) => Promise<unknown>
  saveState: () => Promise<Blob | File | ArrayBuffer | Uint8Array | unknown>
  loadState: (file: File) => Promise<unknown>
  exportState?: () => Promise<Blob | File | ArrayBuffer | Uint8Array | unknown>
  importState?: (file: File) => Promise<unknown>
  focusCanvas?: () => void
  pressDown?: (buttonName: string) => boolean | Promise<boolean>
  pressUp?: (buttonName: string) => boolean | Promise<boolean>
  screenshot?: () => Promise<Blob | File | ArrayBuffer | Uint8Array | unknown>
}

declare global {
  interface Window {
    __RA_N64_IFRAME__?: HTMLIFrameElement | null
    __RA_N64_FOCUS__?: () => void
    N64WasmBridge?: N64WasmBridge
  }
}

function ensureFile(
  value: Blob | File | ArrayBuffer | Uint8Array | unknown,
  name: string,
  fallbackType = 'application/octet-stream',
): File {
  if (value instanceof File) return value
  if (value instanceof Blob) return new File([value], name, { type: value.type || fallbackType })
  if (value instanceof ArrayBuffer) return new File([value], name, { type: fallbackType })
  if (value instanceof Uint8Array) return new File([value], name, { type: fallbackType })

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>

    if (record.file instanceof File) return record.file

    if (record.blob instanceof Blob) {
      const blob = record.blob
      return new File([blob], name, { type: blob.type || fallbackType })
    }

    if (record.bytes instanceof Uint8Array) {
      return new File([record.bytes], name, { type: fallbackType })
    }

    if (record.data instanceof Uint8Array) {
      return new File([record.data], name, { type: fallbackType })
    }

    if (Array.isArray(record.bytes)) {
      return new File([new Uint8Array(record.bytes)], name, { type: fallbackType })
    }

    if (Array.isArray(record.data)) {
      return new File([new Uint8Array(record.data)], name, { type: fallbackType })
    }
  }

  throw new Error(`Unsupported file-like value for ${name}`)
}

async function normalizeN64SaveResult(
  value: Blob | File | ArrayBuffer | Uint8Array | unknown,
  name: string,
  fallbackType = 'application/octet-stream',
): Promise<File> {
  console.log('[n64 bridge] save raw payload', {
    ctor: (value as { constructor?: { name?: string } } | null | undefined)?.constructor?.name,
    type: typeof value,
    keys: value && typeof value === 'object' ? Object.keys(value as Record<string, unknown>) : null,
    name: (value as { name?: string } | null | undefined)?.name,
    size: (value as { size?: number } | null | undefined)?.size,
    mime: (value as { type?: string } | null | undefined)?.type,
    hasArrayBuffer: !!(value as { arrayBuffer?: unknown } | null | undefined)?.arrayBuffer,
  })

  try {
    return ensureFile(value, name, fallbackType)
  } catch {}

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>

    if (typeof (record as Blob).arrayBuffer === 'function') {
      const buffer = await (record as Blob).arrayBuffer()
      return new File([buffer], (record.name as string) || name, {
        type: (record.type as string) || fallbackType,
      })
    }
  }

  throw new Error(`n64 bridge returned unsupported save payload for ${name}`)
}

export function getN64Iframe() {
  return window.__RA_N64_IFRAME__ || null
}

export function focusN64Iframe() {
  try {
    window.__RA_N64_FOCUS__?.()

    const iframeBridge = getN64Iframe()?.contentWindow?.N64WasmBridge
    iframeBridge?.focusCanvas?.()
  } catch {}
}


export async function pressN64ButtonDown(buttonName: string) {
  const bridge = await waitForN64Bridge()
  focusN64Iframe()
  if (bridge.pressDown) {
    return await bridge.pressDown(buttonName)
  }
  return false
}

export async function pressN64ButtonUp(buttonName: string) {
  const bridge = await waitForN64Bridge()
  if (bridge.pressUp) {
    return await bridge.pressUp(buttonName)
  }
  return false
}

export function getN64Canvas(): HTMLCanvasElement | null {
  const iframe = getN64Iframe()
  if (!iframe?.contentWindow?.document) return null

  const canvases = Array.from(iframe.contentWindow.document.querySelectorAll('canvas')) as HTMLCanvasElement[]
  return canvases.find((canvas) => canvas.width > 0 && canvas.height > 0) || canvases[0] || null
}

export async function screenshotN64Bridge(): Promise<File> {
  const bridge = await waitForN64Bridge()

  if (bridge.screenshot) {
    const value = await bridge.screenshot()
    return await normalizeN64SaveResult(value, 'thumbnail.png', 'image/png')
  }

  const canvas = getN64Canvas()
  if (!canvas) {
    throw new Error('N64Wasm canvas not available')
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error('canvas.toBlob returned null'))
    }, 'image/png')
  })

  return new File([blob], 'thumbnail.png', { type: 'image/png' })
}

export async function waitForN64Bridge(timeoutMs = 15000): Promise<N64WasmBridge> {
  const started = Date.now()

  return await new Promise((resolve, reject) => {
    const finish = (bridge?: N64WasmBridge | null) => {
      if (bridge) resolve(bridge)
    }

    const maybeResolve = () => {
      const iframeBridge = getN64Iframe()?.contentWindow?.N64WasmBridge
      const topBridge = window.N64WasmBridge
      const bridge = iframeBridge || topBridge
      if (bridge?.isReady?.() || bridge?.saveState || bridge?.loadRomUrl) {
        finish(bridge)
        return true
      }
      return false
    }

    if (maybeResolve()) return

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'n64wasm-bridge-ready' && maybeResolve()) {
        cleanup()
      }
    }

    const interval = window.setInterval(() => {
      if (maybeResolve()) {
        cleanup()
      } else if (Date.now() - started > timeoutMs) {
        cleanup()
        reject(new Error('Timed out waiting for N64Wasm bridge'))
      }
    }, 100)

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(interval)
    }

    window.addEventListener('message', onMessage)
  })
}

export async function loadN64Rom(url: string, title: string) {
  const bridge = await waitForN64Bridge()
  return await bridge.loadRomUrl(url, title)
}

export async function loadN64State(input: File | string) {
  const bridge = await waitForN64Bridge()
  const file =
    typeof input === 'string'
      ? await fetch(input)
          .then((response) => {
            if (!response.ok) throw new Error(`Failed to fetch state: ${response.status}`)
            return response.blob()
          })
          .then((blob) => new File([blob], 'state.state', { type: blob.type || 'application/octet-stream' }))
      : input

  if (bridge.importState) {
    return await bridge.importState(file)
  }

  return await bridge.loadState(file)
}

export async function saveN64State() {
  const bridge = await waitForN64Bridge()
  const value = bridge.exportState ? await bridge.exportState() : await bridge.saveState()
  return await normalizeN64SaveResult(value, 'state.sav', 'application/octet-stream')
}

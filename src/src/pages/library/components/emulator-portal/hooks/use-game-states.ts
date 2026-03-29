import type { Nostalgist } from 'nostalgist'
import useSWRImmutable from 'swr/immutable'
import useSWRMutation from 'swr/mutation'
import { client, parseResponse } from '#@/api/client.ts'
import { useShowGameOverlayContent } from '#@/pages/library/atoms.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useEmulator } from './use-emulator.ts'
import { saveN64State, screenshotN64Bridge } from './n64wasm-bridge.ts'
import { saveParallelN64State } from './n64-savestate-bridge.ts'

const { $get, $post } = client.states

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextFrame(times = 1) {
  return new Promise<void>((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => step(remaining - 1))
    }
    step(times)
  })
}

async function debugN64Screenshot(emulator: Nostalgist) {
  const started = performance.now()
  try {
    console.log('[n64 debug] screenshot start')
    const shot = await emulator.screenshot()
    const elapsed = Math.round(performance.now() - started)
    console.log('[n64 debug] screenshot ok', { elapsedMs: elapsed, shot })
    return shot
  } catch (error) {
    const elapsed = Math.round(performance.now() - started)
    console.error('[n64 debug] screenshot failed', { elapsedMs: elapsed, error })
    throw error
  }
}

async function captureCanvasThumbnail(emulator: Nostalgist): Promise<File> {
  const canvas = emulator.getCanvas()
  if (!canvas) {
    throw new Error('No emulator canvas available')
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error('canvas.toBlob returned null'))
    }, 'image/png')
  })

  return new File([blob], 'thumbnail.png', { type: 'image/png' })
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed reading file'))
    reader.readAsDataURL(file)
  })
}

async function isMostlyBlackThumbnail(file: File): Promise<boolean> {
  try {
    const img = new Image()
    const src = await fileToDataUrl(file)

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Thumbnail image failed to load'))
      img.src = src
    })

    const sampleWidth = Math.max(1, Math.min(96, img.naturalWidth || img.width || 1))
    const sampleHeight = Math.max(1, Math.min(72, img.naturalHeight || img.height || 1))
    const canvas = document.createElement('canvas')
    canvas.width = sampleWidth
    canvas.height = sampleHeight

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false

    ctx.drawImage(img, 0, 0, sampleWidth, sampleHeight)
    const { data } = ctx.getImageData(0, 0, sampleWidth, sampleHeight)

    let litPixels = 0
    const totalPixels = sampleWidth * sampleHeight

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] || 0
      const g = data[i + 1] || 0
      const b = data[i + 2] || 0
      const a = data[i + 3] || 0
      if (a > 0 && r + g + b > 36) {
        litPixels += 1
      }
    }

    return litPixels / totalPixels < 0.02
  } catch (error) {
    console.warn('[n64wasm thumbnail] black-frame check failed; treating thumbnail as usable', error)
    return false
  }
}

function getResumeButton(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[]
  return candidates.find((el) => (el.textContent || '').trim().toLowerCase() === 'resume') || null
}

async function closeOverlayForThumbnail(): Promise<boolean> {
  const resume = getResumeButton()
  if (!resume) return false

  resume.click()
  await nextFrame(3)
  await sleep(180)
  return true
}

async function reopenOverlayAfterThumbnail(): Promise<void> {
  const eventInit = {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    which: 27,
    bubbles: true,
  }

  window.dispatchEvent(new KeyboardEvent('keydown', eventInit))
  window.dispatchEvent(new KeyboardEvent('keyup', eventInit))
  await nextFrame(3)
  await sleep(180)
}

async function captureN64WasmThumbnail(options: { retries?: number; delayMs?: number } = {}): Promise<File> {
  const retries = Math.max(1, options.retries ?? 6)
  const delayMs = Math.max(0, options.delayMs ?? 180)
  let lastShot: File | null = null
  let lastError: unknown = null
  const overlayWasClosed = await closeOverlayForThumbnail()

  try {
    await nextFrame(6)
    await sleep(300)

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const shot = await screenshotN64Bridge()
        lastShot = shot
        const mostlyBlack = await isMostlyBlackThumbnail(shot)

        if (!mostlyBlack) {
          console.log('[n64wasm thumbnail] using bridge screenshot', { attempt, size: shot.size })
          return shot
        }

        console.warn('[n64wasm thumbnail] rejected mostly-black screenshot', { attempt, size: shot.size })
      } catch (error) {
        lastError = error
        console.warn('[n64wasm thumbnail] bridge screenshot failed', { attempt, error })
      }

      if (attempt < retries && delayMs > 0) {
        await nextFrame(2)
        await sleep(delayMs)
      }
    }

    if (lastShot) {
      console.warn('[n64wasm thumbnail] returning last screenshot after retries')
      return lastShot
    }

    throw lastError || new Error('Failed to capture N64Wasm thumbnail')
  } finally {
    if (overlayWasClosed) {
      await reopenOverlayAfterThumbnail()
    }
  }
}

function ensureFile(
  value: Blob | File | ArrayBuffer | Uint8Array | unknown,
  name: string,
  fallbackType = 'application/octet-stream',
): File {
  if (value instanceof File) {
    return value
  }

  if (value instanceof Blob) {
    return new File([value], name, { type: value.type || fallbackType })
  }

  if (value instanceof ArrayBuffer) {
    return new File([value], name, { type: fallbackType })
  }

  if (value instanceof Uint8Array) {
    return new File([value], name, { type: fallbackType })
  }

  throw new Error(`Unsupported file-like value for ${name}`)
}

async function getStateAndThumbnail(
  emulator: Nostalgist,
  object: { state?: File; thumbnail?: File } = {},
  options: { delayMs?: number; debugScreenshotFirst?: boolean; isParallelN64?: boolean; isN64Wasm?: boolean } = {},
) {
  if (object.state && object.thumbnail) {
    return object as { state: File; thumbnail: File }
  }

  if (options.isN64Wasm && !object.state) {
    const state = await saveN64State()
    let thumbnail: File
    try {
      thumbnail = await captureN64WasmThumbnail({ retries: 6, delayMs: 180 })
    } catch (error) {
      console.error('[save state] n64wasm bridge thumbnail failed', error)
      thumbnail = new File([new Uint8Array()], 'thumbnail.png', { type: 'image/png' })
    }
    return { state, thumbnail }
  }

  if (options.isParallelN64 && !object.state) {
    return saveParallelN64State(emulator, {
      delayMs: options.delayMs,
    })
  }

  let { state, thumbnail } = object

  if (state) {
    if (options.isN64Wasm) {
      try {
        thumbnail = await captureN64WasmThumbnail({ retries: 4, delayMs: 120 })
      } catch (error) {
        console.error('[save state] n64wasm screenshot for provided state failed', error)
        thumbnail = new File([new Uint8Array()], 'thumbnail.png', { type: 'image/png' })
      }
    } else {
      try {
        thumbnail = ensureFile(await emulator.screenshot(), 'thumbnail.png', 'image/png')
      } catch (error) {
        console.error('[save state] screenshot for provided state failed', error)
        try {
          thumbnail = await captureCanvasThumbnail(emulator)
        } catch {
          thumbnail = new File([new Uint8Array()], 'thumbnail.png', { type: 'image/png' })
        }
      }
    }
  } else {
    if (options.delayMs && options.delayMs > 0) {
      console.log(`[save state] delaying ${options.delayMs}ms before emulator.saveState()`)
      await sleep(options.delayMs)
    }

    if (options.debugScreenshotFirst) {
      try {
        const preShot = await debugN64Screenshot(emulator)
        if (!thumbnail) {
          thumbnail = ensureFile(preShot, 'thumbnail.png', 'image/png')
        }
      } catch (error) {
        console.error('[n64 debug] pre-save screenshot step failed', error)
      }
    }

    console.log('[save state] calling emulator.saveState()')
    const result = await emulator.saveState()
    state = ensureFile(result.state, 'state.sav', 'application/octet-stream')

    if (!thumbnail) {
      if (result.thumbnail) {
        thumbnail = ensureFile(result.thumbnail, 'thumbnail.png', 'image/png')
      } else {
        try {
          thumbnail = ensureFile(await emulator.screenshot(), 'thumbnail.png', 'image/png')
        } catch (error) {
          console.error('[save state] final screenshot fallback failed', error)
          try {
            thumbnail = await captureCanvasThumbnail(emulator)
          } catch {
            thumbnail = new File([new Uint8Array()], 'thumbnail.png', { type: 'image/png' })
          }
        }
      }
    }
  }

  if (!state || !thumbnail) {
    throw new Error('Failed to build save state payload')
  }

  return { state, thumbnail }
}

export function useGameStates() {
  const rom = useRom()
  const { core, emulator } = useEmulator()
  const [showGameOverlay] = useShowGameOverlayContent()

  const isN64Wasm = rom?.platform === 'n64'
  const isParallelN64 = rom?.platform === 'n64' && core === 'parallel_n64' && !isN64Wasm
  const n64SaveDelayMs = isParallelN64 ? 2500 : 0

  const {
    data: manualStates,
    isLoading: isStatesLoading,
    mutate: reloadStates,
  } = useSWRImmutable(
    rom ? { endpoint: '/api/v1/roms/:id/states', query: { rom: rom.id, type: 'manual' } as const } : false,
    ({ query }) => parseResponse($get({ query })),
  )

  const { data: autoStates, mutate: reloadAutoStates } = useSWRImmutable(
    rom ? { endpoint: '/api/v1/roms/:id/states', query: { rom: rom.id, type: 'auto' } as const } : false,
    ({ query }) => parseResponse($get({ query })),
    { dedupingInterval: 0, revalidateOnMount: true },
  )

  const states = [...(manualStates || []), ...(autoStates || [])]

  const { isMutating: isSavingManualState, trigger: saveManualState } = useSWRMutation(
    '/api/v1/states',
    async (_key, { arg = {} }: { arg?: { state?: File; thumbnail?: File } }) => {
      if (!core || !rom || (!emulator && !isN64Wasm)) {
        throw new Error('invalid emulator or core or rom')
      }

      try {
        const { state, thumbnail } = await getStateAndThumbnail(emulator as Nostalgist, arg, {
          delayMs: isParallelN64 ? n64SaveDelayMs : 0,
          debugScreenshotFirst: false,
          isParallelN64,
          isN64Wasm,
        })
        console.log('[save state][manual] core=', core, 'rom=', rom.id, 'state=', state, 'thumbnail=', thumbnail)
        await $post({ form: { core, rom: rom.id, state, thumbnail, type: 'manual' } })
        console.log('[save state][manual] upload ok')
        await Promise.all([reloadStates(), reloadAutoStates()])
      } catch (error) {
        console.error('[save state][manual] failed', error)
        throw error
      }
    },
  )

  const { isMutating: isSavingAutoState, trigger: saveAutoState } = useSWRMutation('/api/v1/states', async () => {
    if (!core || !rom || (!emulator && !isN64Wasm)) {
      throw new Error('invalid emulator or core or rom')
    }

    try {
      const { state, thumbnail } = await getStateAndThumbnail(emulator as Nostalgist, {}, {
        delayMs: isParallelN64 ? n64SaveDelayMs : 0,
        debugScreenshotFirst: false,
        isParallelN64,
        isN64Wasm,
      })
      console.log('[save state][auto] core=', core, 'rom=', rom.id, 'state=', state, 'thumbnail=', thumbnail)
      await $post({
        form: { core, rom: rom.id, state, thumbnail, type: 'auto' },
      })
      console.log('[save state][auto] upload ok')
      await reloadAutoStates()
    } catch (error) {
      console.error('[save state][auto] failed', error)
      throw error
    }
  })

  return {
    isSavingAutoState,
    isSavingManualState,
    isStatesLoading,
    reloadAutoStates,
    reloadStates,
    saveAutoState,
    saveManualState,
    showGameOverlay,
    states,
  }
}

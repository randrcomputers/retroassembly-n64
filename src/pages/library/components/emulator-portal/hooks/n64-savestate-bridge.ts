import type { Nostalgist } from 'nostalgist'

const N64_MIN_STATE_SIZE = 50_000
const N64_REQUIRED_STABLE_POLLS = 8
const N64_MAX_POLLS = 260
const N64_POLL_DELAY_MS = 350

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uint8ArrayEquals(a?: Uint8Array | null, b?: Uint8Array | null) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
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

function safeReadBinary(fs: any, path: string): Uint8Array | null {
  try {
    const read = fs.readFile(path, { encoding: 'binary' }) as Uint8Array
    return read instanceof Uint8Array ? read : new Uint8Array(read)
  } catch {
    return null
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

function getPaths(emulator: Nostalgist) {
  const inner = emulator.getEmulator?.()
  const statePath =
    inner?.stateFilePath || '/home/web_user/retroarch/userdata/states/ParaLLEl N64/rom.state'
  const autoPath = `${statePath}.auto`
  const thumbPath = inner?.stateThumbnailFilePath || `${statePath}.png`

  return { statePath, autoPath, thumbPath }
}

export async function loadParallelN64State(
  emulator: Nostalgist,
  stateFile: File,
): Promise<void> {
  console.log('[parallel_n64 bridge] clean runtime load: using emulator.loadState(file) only', {
    name: stateFile.name,
    size: stateFile.size,
    type: stateFile.type,
  })

  await emulator.loadState(stateFile)

  console.log('[parallel_n64 bridge] clean runtime load: emulator.loadState(file) completed')
}

export async function saveParallelN64State(
  emulator: Nostalgist,
  options: { delayMs?: number } = {},
): Promise<{ state: File; thumbnail: File }> {
  if (options.delayMs && options.delayMs > 0) {
    console.log(`[parallel_n64 bridge] delaying ${options.delayMs}ms before save polling`)
    await sleep(options.delayMs)
  }

  const fs = emulator.getEmscriptenFS()
  const module = emulator.getEmscriptenModule?.()
  const { statePath, autoPath, thumbPath } = getPaths(emulator)

  if (!fs) {
    throw new Error('parallel_n64 save failed: missing FS')
  }

  if (!module?._cmd_save_state) {
    throw new Error('parallel_n64 save failed: _cmd_save_state unavailable')
  }

  const beforeAutoBytes = safeReadBinary(fs, autoPath)
  const beforeStateBytes = safeReadBinary(fs, statePath)

  console.log('[parallel_n64 bridge] initial existing state snapshot', {
    autoPath,
    autoSize: beforeAutoBytes?.length ?? 0,
    statePath,
    stateSize: beforeStateBytes?.length ?? 0,
  })

  let thumbnail: File | undefined

  try {
    const shot = await Promise.race([
      emulator.screenshot(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('parallel_n64 screenshot timeout before save')), 4000),
      ),
    ])
    thumbnail = ensureFile(shot, 'thumbnail.png', 'image/png')
    console.log('[parallel_n64 bridge] emulator.screenshot ok before save')
  } catch (error) {
    console.warn('[parallel_n64 bridge] screenshot before save failed; will try after save', error)
  }

  console.log('[parallel_n64 bridge] forcing SAVE_STATE command')
  module._cmd_save_state()

  const dir = statePath.substring(0, statePath.lastIndexOf('/'))
  try {
    console.log('[parallel_n64 bridge] state dir before polling', {
      dir,
      files: fs.readdir(dir),
      expectedAuto: autoPath.substring(autoPath.lastIndexOf('/') + 1),
      expectedState: statePath.substring(statePath.lastIndexOf('/') + 1),
    })
  } catch {}

  let bytes: Uint8Array | null = null
  let sourcePath: string | null = null
  let lastError: unknown = null
  let previousAutoSize = -1
  let previousStateSize = -1
  let stableCount = 0

  for (let i = 0; i < N64_MAX_POLLS; i++) {
    await sleep(N64_POLL_DELAY_MS)

    try {
      const autoArr = safeReadBinary(fs, autoPath)
      const stateArr = safeReadBinary(fs, statePath)

      const autoSize = autoArr?.length ?? 0
      const stateSize = stateArr?.length ?? 0

      const sizeChanged = autoSize !== previousAutoSize || stateSize !== previousStateSize

      if (sizeChanged) {
        stableCount = 0
      } else {
        stableCount += 1
      }

      const autoChangedFromBefore = beforeAutoBytes ? !uint8ArrayEquals(autoArr, beforeAutoBytes) : !!autoArr
      const stateChangedFromBefore = beforeStateBytes ? !uint8ArrayEquals(stateArr, beforeStateBytes) : !!stateArr

      console.log('[parallel_n64 bridge] poll', {
        attempt: i + 1,
        autoPath,
        autoSize,
        previousAutoSize,
        autoChangedFromBefore,
        statePath,
        stateSize,
        previousStateSize,
        stateChangedFromBefore,
        stableCount,
      })

      previousAutoSize = autoSize
      previousStateSize = stateSize

      const candidate =
        autoArr && autoArr.length >= N64_MIN_STATE_SIZE
          ? { bytes: autoArr, path: autoPath }
          : stateArr && stateArr.length >= N64_MIN_STATE_SIZE
            ? { bytes: stateArr, path: statePath }
            : null

      if (!candidate) continue

      if (stableCount >= N64_REQUIRED_STABLE_POLLS) {
        bytes = candidate.bytes
        sourcePath = candidate.path

        console.log('[parallel_n64 bridge] final state file accepted', {
          sourcePath,
          size: bytes.length,
          attempt: i + 1,
          stableCount,
        })
        break
      }
    } catch (error) {
      lastError = error
    }
  }

  if (!bytes || !sourcePath) {
    console.error('[parallel_n64 bridge] failed to read stable state file', {
      autoPath,
      previousAutoSize,
      statePath,
      previousStateSize,
      lastError,
    })
    throw new Error(`parallel_n64 state file was not stably created at ${autoPath}`)
  }

  if (!thumbnail) {
    try {
      const shot = await Promise.race([
        emulator.screenshot(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('parallel_n64 screenshot timeout after save')), 4000),
        ),
      ])
      thumbnail = ensureFile(shot, 'thumbnail.png', 'image/png')
      console.log('[parallel_n64 bridge] screenshot ok after save finished')
    } catch (error) {
      console.warn('[parallel_n64 bridge] screenshot after save failed; using canvas fallback', error)
      thumbnail = await captureCanvasThumbnail(emulator)
    }
  }

  try {
    const fileThumb = safeReadBinary(fs, thumbPath)
    if (fileThumb && fileThumb.length > 0) {
      thumbnail = ensureFile(fileThumb, 'thumbnail.png', 'image/png')
      console.log('[parallel_n64 bridge] using state thumbnail file from FS')
    }
  } catch {}

  console.log('[parallel_n64 bridge] returning saved state file', {
    sourcePath,
    size: bytes.length,
  })

  const state = ensureFile(bytes, 'state.sav', 'application/octet-stream')
  return { state, thumbnail }
}
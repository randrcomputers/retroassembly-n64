import { attemptAsync, noop } from 'es-toolkit'
import { Nostalgist } from 'nostalgist'
import { useEffect, useMemo } from 'react'
import { useLoaderData } from 'react-router'
import useSWRImmutable from 'swr/immutable'
import { client } from '#@/api/client.ts'
import type { Rom } from '#@/controllers/roms/get-roms.ts'
import {
  useEmulatorLaunched,
  useIsFullscreen,
  useLaunchButton,
  useSpatialNavigationPaused,
} from '#@/pages/library/atoms.ts'
import { useIsDemo } from '#@/pages/library/hooks/use-demo.ts'
import { useGamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useRouter } from '#@/pages/library/hooks/use-router.ts'
import { getFileUrl } from '#@/pages/library/utils/file.ts'
import { focus, offCancel, onCancel } from '#@/pages/library/utils/spatial-navigation.ts'
import type { loader } from '#@/pages/routes/library-platform-rom.tsx'
import { getCDNUrl } from '#@/utils/isomorphic/cdn.ts'
import { getGlobalCSSVars } from '#@/utils/isomorphic/misc.ts'
import { usePreference } from '../../../hooks/use-preference.ts'
import { focusN64Iframe, getN64Canvas, loadN64State, pressN64ButtonDown, pressN64ButtonUp, screenshotN64Bridge, waitForN64Bridge } from './n64wasm-bridge.ts'

type NostalgistOption = Parameters<typeof Nostalgist.prepare>[0]
type RetroarchConfig = Partial<NostalgistOption['retroarchConfig']>

const defaultRetroarchConfig: RetroarchConfig = {
  fastforward_ratio: 10,
  input_enable_hotkey_btn: 8,
  input_hold_fast_forward_btn: 7,
  input_player1_analog_dpad_mode: 1,
  input_player2_analog_dpad_mode: 1,
  input_player3_analog_dpad_mode: 1,
  input_player4_analog_dpad_mode: 1,
  input_rewind_btn: 6,
  rewind_enable: true,
  rewind_granularity: 4,
  rgui_menu_color_theme: 1,
  run_ahead_enabled: true,
  run_ahead_frames: 1,
}

const experimentalCoreMap = {
  mupen64plus_next: {
    js: 'https://cdn.jsdelivr.net/gh/BinBashBanana/webretro@master/cores/mupen64plus_next_libretro.js',
    name: 'mupen64plus_next',
    wasm: 'https://cdn.jsdelivr.net/gh/BinBashBanana/webretro@master/cores/mupen64plus_next_libretro.wasm',
  },
  parallel_n64: {
    js: 'https://cdn.jsdelivr.net/gh/BinBashBanana/webretro@master/cores/parallel_n64_libretro.js',
    name: 'parallel_n64',
    wasm: 'https://cdn.jsdelivr.net/gh/BinBashBanana/webretro@master/cores/parallel_n64_libretro.wasm',
  },
} as const

let wakeLock: undefined | WakeLockSentinel
const originalGetUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices)

type N64Facade = {
  exit: () => void
  getCanvas: () => HTMLCanvasElement | HTMLIFrameElement | null
  getStatus: () => 'paused' | 'running' | 'stopped'
  loadState: (value: File | string) => Promise<void>
  pause: () => void
  pressDown: (_buttonName: string) => void
  pressUp: (_buttonName: string) => void
  resume: () => void
  screenshot: () => Promise<File>
}

export function useEmulator() {
  const rom: Rom = useRom()
  const { state } = useLoaderData<typeof loader>()
  const { preference } = usePreference()
  const gamepadMapping = useGamepadMapping()
  const [launched, setLaunched] = useEmulatorLaunched()
  const isDemo = useIsDemo()
  const { reload } = useRouter()
  const [isFullscreen, setIsFullscreen] = useIsFullscreen()
  const [launchButton] = useLaunchButton()
  const [, setSpatialNavigationPaused] = useSpatialNavigationPaused()

  const isN64 = rom?.platform === 'n64'

  const { core } = preference.emulator.platform[rom.platform] || {}
  const selectedCore = core
  const resolvedCore = selectedCore
    ? experimentalCoreMap[selectedCore as keyof typeof experimentalCoreMap] || selectedCore
    : selectedCore

  const romUrl = isDemo
    ? getCDNUrl(`retrobrews/${{ genesis: 'md' }[rom.platform] || rom.platform}-games`, rom.fileName)
    : getFileUrl(rom.fileId) || ''

  let { shader } = preference.emulator.platform[rom.platform]
  if (shader === 'inherit') {
    shader = preference.emulator.shader
  } else {
    shader ??= preference.emulator.shader
  }

  const platformRetroarchConfig: RetroarchConfig =
    rom.platform === 'n64'
      ? {
          input_player1_analog_dpad_mode: 0,
          input_player1_l_x_minus: 'left',
          input_player1_l_x_plus: 'right',
          input_player1_l_y_minus: 'up',
          input_player1_l_y_plus: 'down',
          savestate_thumbnail_enable: false,
          savestate_auto_load: false,
        }
      : {}

  const romObject = useMemo(() => ({ fileContent: romUrl, fileName: rom?.fileName }), [rom, romUrl])
  const bios = preference.emulator.platform[rom.platform].bioses.map(({ fileId, fileName }) => ({
    fileContent: getFileUrl(fileId),
    fileName,
  }))

  const options: NostalgistOption = useMemo(
    () => ({
      bios,
      core: resolvedCore,
      retroarchConfig: {
        ...defaultRetroarchConfig,
        ...preference.input.keyboardMapping,
        ...gamepadMapping,
        ...platformRetroarchConfig,
        video_smooth: preference.emulator.videoSmooth,
      },
      retroarchCoreConfig: selectedCore ? preference.emulator.core[selectedCore] : undefined,
      rom: romObject,
      shader,
      state: !isN64 && state?.fileId ? getFileUrl(state.fileId) : undefined,
    }),
    [
      rom.platform,
      romObject,
      bios,
      selectedCore,
      resolvedCore,
      preference,
      gamepadMapping,
      shader,
      state?.fileId,
      isN64,
    ],
  )

  const {
    data: preparedEmulator,
    error,
    isValidating,
    mutate: prepare,
  } = useSWRImmutable(isN64 ? false : options, () => Nostalgist.prepare(options))

  const n64Facade = useMemo<N64Facade | undefined>(() => {
    if (!isN64) return undefined

    return {
      exit: () => {},
      getCanvas: () => getN64Canvas() || window.__RA_N64_IFRAME__ || null,
      getStatus: () => (launched ? 'running' : 'stopped'),
      loadState: async (value) => {
        await loadN64State(value)
      },
      pause: () => {},
      pressDown: (buttonName) => {
        void pressN64ButtonDown(buttonName)
      },
      pressUp: (buttonName) => {
        void pressN64ButtonUp(buttonName)
      },
      resume: () => {
        focusN64Iframe()
      },
      screenshot: async () => await screenshotN64Bridge(),
    }
  }, [isN64, launched])

  const emulator = (isN64 ? n64Facade : preparedEmulator) as any
  const isPreparing = !rom || (!isN64 && isValidating)

  const shouldKeepParentFocus = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    if (target.closest('iframe')) return false

    return !!target.closest(
      [
        'a[href]',
        'button',
        'dialog',
        'input',
        'select',
        'textarea',
        '[contenteditable="true"]',
        '[role="button"]',
        '[role="dialog"]',
        '[role="menu"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="textbox"]',
        '[data-radix-dialog-content]',
        '[data-radix-menu-content]',
        '[data-radix-popper-content-wrapper]',
        '[aria-modal="true"]',
      ].join(','),
    )
  }

  const scheduleFocusBackToGame = (delay = 0) => {
    window.setTimeout(() => {
      if (!isN64 || !launched) return
      if (document.hidden) return
      if (document.fullscreenElement && document.fullscreenElement !== document.body) return

      const active = document.activeElement
      if (active instanceof HTMLIFrameElement) return
      if (shouldKeepParentFocus(active)) return

      focusN64Iframe()
    }, delay)
  }

  async function launch({ withState: _withState }: { withState?: boolean } = {}) {
    if (!rom) return

    if (isN64) {
      ;(window as typeof window & { __RA_N64_LAUNCH_STATE_URL__?: string | null }).__RA_N64_LAUNCH_STATE_URL__ =
        _withState && state?.fileId ? getFileUrl(state.fileId) : null
    }

    if (!isN64 && preparedEmulator) {
      const withState = _withState
      if (!withState) {
        preparedEmulator.getEmulator().on('beforeLaunch', () => {
          try {
            preparedEmulator.getEmscriptenFS().unlink(`${preparedEmulator.getEmulator().stateFilePath}.auto`)
          } catch {}
        })
      } else {
        preparedEmulator.getEmulator().on('beforeLaunch', () => {
          console.log('[launch] saved-state launch, keeping state files')
        })
      }

      const canvas = preparedEmulator.getCanvas()
      canvas.setAttribute('tabindex', '-1')
      canvas.dataset.snFocusStyle = JSON.stringify({ display: 'none' })
      focus(canvas)
    }

    setLaunched(true)

    if (!isDemo) {
      await client.launch_records.$post({ form: { core: selectedCore, rom: rom.id } })
    }
  }

  async function start() {
    if (!rom) return

    if (isN64) {
      // N64 iframe already boots with autostart=1 and the ROM in its query string.
      // Do not call loadN64Rom() here or the ROM gets loaded a second time after boot.
      await waitForN64Bridge().catch(() => undefined)

      ;(window as typeof window & { __RA_N64_LAUNCH_STATE_URL__?: string | null }).__RA_N64_LAUNCH_STATE_URL__ ??= null

      focusN64Iframe()

      if (preference.emulator.fullscreen) {
        await toggleFullscreen()
      }

      try {
        wakeLock = await navigator.wakeLock.request('screen')
      } catch {}

      onCancel(noop)
      return
    }

    if (!preparedEmulator) return

    try {
      // @ts-expect-error ad-hoc patch
      globalThis.navigator.mediaDevices.getUserMedia = null
    } catch {}

    await preparedEmulator.start()
    ;(window as any).__RA_EMU__ = preparedEmulator

    console.log('[debug] selectedCore =', selectedCore)

    try {
      globalThis.navigator.mediaDevices.getUserMedia = originalGetUserMedia
    } catch {}

    const canvas = preparedEmulator.getCanvas()
    if (canvas) {
      canvas.style.opacity = '1'
      const cssVars = getGlobalCSSVars(preference)
      if (cssVars['--game-saturate'] !== '100%') {
        canvas.style.filter = `saturate(var(--game-saturate))`
      }

      focus(canvas)
    }

    if (preference.emulator.fullscreen) {
      await toggleFullscreen()
    }

    try {
      wakeLock = await navigator.wakeLock.request('screen')
    } catch {}

    onCancel(noop)
  }

  async function exit({ reloadAfterExit = false } = {}) {
    const status = emulator?.getStatus?.() || ''
    if (['paused', 'running'].includes(status)) {
      emulator?.exit?.()
      setLaunched(false)
      ;(window as typeof window & { __RA_N64_LAUNCH_STATE_URL__?: string | null }).__RA_N64_LAUNCH_STATE_URL__ = null

      const promises: Promise<void>[] = []
      if (document.fullscreenElement) {
        promises.push(document.exitFullscreen())
      }
      if (wakeLock) {
        promises.push(wakeLock.release())
        wakeLock = undefined
      }
      if (promises.length > 0) {
        await attemptAsync(() => Promise.all(promises))
      }

      setSpatialNavigationPaused(false)
      setIsFullscreen(false)

      if (!isN64) {
        focus(launchButton)
      }

      offCancel()
      if (!isN64) {
        await attemptAsync(prepare)
      }

      if (reloadAfterExit) {
        await reload()
      }
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        setIsFullscreen(false)
      } else {
        await document.body.requestFullscreen()
        setIsFullscreen(true)
      }
    } catch {}

    if (isN64) {
      focusN64Iframe()
    } else if (preparedEmulator) {
      focus(preparedEmulator.getCanvas())
    }
  }

  useEffect(() => {
    const abortController = new AbortController()
    document.body.addEventListener(
      'fullscreenchange',
      () => {
        setIsFullscreen(document.fullscreenElement === document.body)
      },
      { signal: abortController.signal },
    )
    return () => {
      abortController.abort()
    }
  })

  useEffect(() => {
    if (!isN64) return

    ;(window as typeof window & { __RA_N64_LAUNCH_STATE_URL__?: string | null }).__RA_N64_LAUNCH_STATE_URL__ = null
  }, [isN64, state?.fileId])

  useEffect(() => {
    if (!isN64 || !launched) return

    const onWindowFocus = () => {
      scheduleFocusBackToGame(0)
    }

    const onVisibilityChange = () => {
      if (!document.hidden) {
        scheduleFocusBackToGame(0)
      }
    }

    const onFullscreenChange = () => {
      scheduleFocusBackToGame(0)
    }

    const onFocusIn = (event: FocusEvent) => {
      if (shouldKeepParentFocus(event.target)) return
      scheduleFocusBackToGame(30)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (shouldKeepParentFocus(event.target)) return
      scheduleFocusBackToGame(0)
    }

    window.addEventListener('focus', onWindowFocus, true)
    document.addEventListener('visibilitychange', onVisibilityChange, true)
    document.addEventListener('fullscreenchange', onFullscreenChange, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('pointerdown', onPointerDown, true)

    scheduleFocusBackToGame(0)

    return () => {
      window.removeEventListener('focus', onWindowFocus, true)
      document.removeEventListener('visibilitychange', onVisibilityChange, true)
      document.removeEventListener('fullscreenchange', onFullscreenChange, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [isN64, launched])

  return {
    core: selectedCore,
    emulator,
    error,
    exit,
    isFullscreen,
    isPreparing,
    launch,
    launched,
    prepare,
    setLaunched,
    start,
    toggleFullscreen,
  }
}

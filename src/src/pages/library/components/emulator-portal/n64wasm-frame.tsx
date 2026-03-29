import { useEffect, useMemo, useRef } from 'react'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { getFileUrl } from '#@/pages/library/utils/file.ts'

declare global {
  interface Window {
    __RA_N64_IFRAME__?: HTMLIFrameElement | null
    __RA_N64_FOCUS__?: () => void
    __RA_N64_LAUNCH_STATE_URL__?: string | null
  }
}

export function N64WasmFrame() {
  const rom = useRom()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const src = useMemo(() => {
    const romUrl = getFileUrl(rom.fileId) || ''
    const params = new URLSearchParams({
      autostart: '1',
      embed: '1',
      hideMenu: '1',
      title: rom.fileName || rom.name || 'Nintendo 64',
      rom: romUrl,
    })
    const startupStateUrl = window.__RA_N64_LAUNCH_STATE_URL__
    if (startupStateUrl) params.set('state', startupStateUrl)
    return `/n64wasm/index.html?${params.toString()}`
  }, [rom])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    const focusIframe = () => {
      try {
        iframe.focus()
        iframe.contentWindow?.focus()
      } catch {}
    }

    window.__RA_N64_IFRAME__ = iframe
    window.__RA_N64_FOCUS__ = focusIframe

    const onLoad = () => {
      window.requestAnimationFrame(() => {
        focusIframe()
      })
    }

    iframe.addEventListener('load', onLoad)

    return () => {
      iframe.removeEventListener('load', onLoad)
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow

      if (window.__RA_N64_IFRAME__ === iframe) {
        window.__RA_N64_IFRAME__ = null
      }
      if (window.__RA_N64_FOCUS__ === focusIframe) {
        window.__RA_N64_FOCUS__ = undefined
      }
    }
  }, [src])

  return (
    <div className='fixed inset-0 z-[1] flex items-center justify-center overflow-hidden bg-black'>
      <div
        className='relative overflow-hidden bg-black'
        style={{
          width: 'min(100vw, calc(100vh * 4 / 3))',
          height: 'min(100vh, calc(100vw * 3 / 4))',
          aspectRatio: '4 / 3',
        }}
      >
        <iframe
          ref={iframeRef}
          allow='autoplay; fullscreen'
          className='absolute inset-0 h-full w-full border-0 bg-black'
          src={src}
          tabIndex={0}
          title='N64Wasm'
          scrolling='no'
        />
      </div>
    </div>
  )
}

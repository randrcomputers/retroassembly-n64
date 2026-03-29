import { delay } from 'es-toolkit'
import { useEffect } from 'react'
import { useIsGameOverlayPendingAtom, useShowGameOverlayContent } from '#@/pages/library/atoms.ts'
import { useEmulator } from './use-emulator.ts'
import { useGameStates } from './use-game-states.ts'

export function useGameOverlay() {
  const [visible, setVisible] = useShowGameOverlayContent()
  const [isPending, setIsPending] = useIsGameOverlayPendingAtom()
  const { emulator } = useEmulator()
  const { reloadStates } = useGameStates()

  async function show() {
    if (emulator) {
      const status = emulator.getStatus()
      if (status === 'running' || status === 'paused') {
        emulator.pause()
        setVisible(true)
        await reloadStates()
      }
    }
  }


  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const type = event?.data?.type
      if (type === 'n64wasm-escape' || type === 'ra-n64-escape') {
        void show()
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [show])

  async function hide() {
    if (isPending) {
      return
    }
    setVisible(false)
    await delay(100)

    const canvas = emulator?.getCanvas?.()
    if (canvas && typeof canvas.focus === 'function') {
      try {
        canvas.focus({ preventScroll: true })
      } catch {
        canvas.focus()
      }
    }

    emulator?.resume()
  }

  async function toggle() {
    await (visible ? hide() : show())
  }

  return { hide, isPending, setIsPending, show, toggle, visible }
}

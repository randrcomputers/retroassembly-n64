import { delay } from 'es-toolkit'
import { isMatch } from 'es-toolkit/compat'
import { AnimatePresence, motion, type TargetAndTransition } from 'motion/react'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useLaunchButton } from '../../atoms.ts'
import { N64WasmFrame } from './n64wasm-frame.tsx'
import { useAutosave } from './hooks/use-autosave.ts'
import { useEmulator } from './hooks/use-emulator.ts'

export function GameAnimatePresence() {
  const rom = useRom()
  const isN64 = rom?.platform === 'n64'
  const { emulator, launched, start } = useEmulator()

  const animateStyle = { height: '100%', left: 0, top: 0, width: '100%' }
  const [launchButton] = useLaunchButton()
  const rect = launchButton?.getBoundingClientRect()
  const initialStyle = rect ? { height: rect.height, left: rect.left, top: rect.top, width: rect.width } : {}

  useAutosave()

  async function handleAnimationComplete(definition: TargetAndTransition) {
    if (isMatch(definition, animateStyle)) {
      document.body.classList.add('overflow-hidden')
      await delay(0)
      await start()
    } else {
      document.body.classList.remove('overflow-hidden')
    }
  }

  return (
    <AnimatePresence>
      {launched ? (
        <>
          <motion.div
            animate={{ ...animateStyle, backgroundColor: 'black', opacity: 1 }}
            className='fixed inset-0 z-0 bg-black pointer-events-none'
            exit={{ ...initialStyle, backgroundColor: 'var(--accent-9)', opacity: 0.5 }}
            initial={{ ...initialStyle, backgroundColor: 'var(--accent-9)', opacity: 1 }}
            onAnimationComplete={handleAnimationComplete}
            transition={{ duration: 0.3 }}
          />
          {isN64 ? <N64WasmFrame /> : null}
        </>
      ) : null}
    </AnimatePresence>
  )
}

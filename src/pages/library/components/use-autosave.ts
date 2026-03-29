import { clsx } from 'clsx'
import { type ButtonHTMLAttributes, useRef, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { useEmulator } from '../hooks/use-emulator.ts'

interface VirtualGamepadButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  buttonName?: string
  buttonNames?: string[]
}

const SLIDE_BUTTON_NAMES = new Set(['up', 'down', 'left', 'right'])

export function VirtualGamepadButton({
  buttonName,
  buttonNames,
  children,
  className,
  ...props
}: Readonly<VirtualGamepadButtonProps>) {
  const { emulator } = useEmulator()
  const [touching, setTouching] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const activeButtonNamesRef = useRef<string[]>([])

  const resolvedButtonNames = buttonNames || (buttonName ? [buttonName] : [])

  function pressButtons(nextButtonNames: string[]) {
    if (!emulator) return
    for (const currentButtonName of nextButtonNames) {
      emulator.pressDown(currentButtonName)
    }
  }

  function releaseButtons(nextButtonNames: string[]) {
    if (!emulator) return
    for (const currentButtonName of nextButtonNames) {
      emulator.pressUp(currentButtonName)
    }
  }

  function setActiveButtons(nextButtonNames: string[]) {
    const previous = activeButtonNamesRef.current
    const prevKey = previous.join('|')
    const nextKey = nextButtonNames.join('|')
    if (prevKey === nextKey) return

    if (previous.length > 0) {
      releaseButtons(previous)
    }
    activeButtonNamesRef.current = nextButtonNames
    if (nextButtonNames.length > 0) {
      pressButtons(nextButtonNames)
    }
  }

  function handleTouchStart() {
    if (!emulator) return
    setTouching(true)
    setActiveButtons(resolvedButtonNames)
  }

  function handleTouchMove(event: React.TouchEvent<HTMLButtonElement>) {
    if (!emulator || activeButtonNamesRef.current.length === 0) return
    if (!resolvedButtonNames.some((name) => SLIDE_BUTTON_NAMES.has(name))) return

    const touch = event.touches[0]
    if (!touch) return

    const element = document.elementFromPoint(touch.clientX, touch.clientY)
    const targetButton = element?.closest?.('[data-virtual-gamepad-button="1"]') as HTMLButtonElement | null

    if (!targetButton) return

    const raw = targetButton.dataset.buttonNames || ''
    const nextButtonNames = raw
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean)

    if (nextButtonNames.length === 0) return
    if (!nextButtonNames.some((name) => SLIDE_BUTTON_NAMES.has(name))) return

    setActiveButtons(nextButtonNames)
    setTouching(targetButton === buttonRef.current)
    event.preventDefault()
  }

  function handleTouchEnd() {
    setTouching(false)
    setActiveButtons([])
  }

  return (
    <button
      ref={buttonRef}
      className={twMerge(
        clsx(
          'inline-flex items-center justify-center gap-1 select-none',
          touching ? 'bg-white text-(--color-text)' : 'bg-black/20 text-white/50',
        ),
        className,
      )}
      data-button-names={resolvedButtonNames.join('|')}
      data-virtual-gamepad-button='1'
      type='button'
      {...props}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
    >
      {children}
    </button>
  )
}

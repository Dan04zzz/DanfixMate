import { useEffect } from 'react'

type Binding = {
  combo: string
  handler: (e: KeyboardEvent) => void
  /** attiva anche mentre si scrive in un campo */
  allowInInputs?: boolean
  /** mai mentre si scrive, nemmeno con Ctrl (es. Ctrl+A deve selezionare il testo) */
  noInputs?: boolean
}

/** combo: "ctrl+n", "ctrl+shift+b", "f5", "/" */
const matches = (e: KeyboardEvent, combo: string): boolean => {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop()!
  return (
    e.key.toLowerCase() === key &&
    e.ctrlKey === parts.includes('ctrl') &&
    e.shiftKey === parts.includes('shift') &&
    e.altKey === parts.includes('alt')
  )
}

export function useHotkeys(bindings: Binding[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      for (const b of bindings) {
        if (matches(e, b.combo) && (!typing || (!b.noInputs && (b.allowInInputs || e.ctrlKey)))) {
          e.preventDefault()
          b.handler(e)
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bindings])
}

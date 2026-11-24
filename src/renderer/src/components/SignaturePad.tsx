import { Eraser } from 'lucide-react'
import { useEffect, useRef } from 'react'

/** Firma del cliente su canvas (mouse, penna o touch). Esporta un PNG trasparente con tratto scuro. */
export function SignaturePad({
  value,
  onChange
}: {
  value: string | null
  onChange: (dataUrl: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  // carica la firma salvata
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    dirty.current = !!value
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height)
      img.src = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current!.getContext('2d')!
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pos(e)
    ctx.lineWidth = e.pressure > 0 && e.pointerType === 'pen' ? 1.5 + e.pressure * 3 : 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    dirty.current = true
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (dirty.current) onChange(canvasRef.current!.toDataURL('image/png'))
  }
  const clear = () => {
    const c = canvasRef.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    dirty.current = false
    onChange(null)
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-ink-600 bg-[#f8fafc]">
        <canvas
          ref={canvasRef}
          width={1200}
          height={360}
          className="block h-44 w-full touch-none"
          style={{ cursor: 'crosshair' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-slate-300" />
        {!value && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">
            Firma qui con mouse, penna o dito
          </span>
        )}
      </div>
      <button className="btn mt-2 px-2 py-1 text-xs text-ink-300 hover:text-ink-100" onClick={clear}>
        <Eraser className="size-3.5" /> Cancella firma
      </button>
    </div>
  )
}

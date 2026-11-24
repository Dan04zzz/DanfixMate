const fmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })

export const formatCents = (cents: number): string => fmt.format(cents / 100)

/** "45,50" | "45.5" | "45" -> 4550. Ritorna 0 se non valido. */
export const parseEuroToCents = (value: string): number => {
  const normalized = value
    .replace(/\s|€/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
  const n = Number.parseFloat(normalized)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Margine = preventivo - (costi esterni + manodopera interna) */
export const computeMarginCents = (quote: number, externalCost: number, labor: number): number =>
  quote - externalCost - labor

// Best-effort reading of a supplier invoice PDF, with no paid service: the text is
// pulled out of the PDF in the browser and a few rules look for the supplier, the
// total, the currency and the invoice number. Scanned images have no text, so
// nothing is found for them. The result only pre-fills the form; you review it.

export type InvoiceInfo = {
  contractor: string | null
  amount: number | null
  currency: 'Dólares' | 'Florines' | 'Euros' | null
  reference: string | null // e.g. "Factura 2382"
}

export type KnownContractor = { name: string; count: number; email: string | null }

// ---------- PDF text ----------

export async function readPdfText(file: File, maxPages = 3): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const out: string[] = []
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
    const content = await (await pdf.getPage(p)).getTextContent()
    // Rebuild visual lines: items on (nearly) the same height form one line.
    const items = content.items
      .filter((i): i is { str: string; transform: number[] } & typeof i => 'str' in i && 'transform' in i)
      .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))
      .filter((i) => i.s.trim() !== '')
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    let line: typeof items = []
    const flush = () => { if (line.length) out.push(line.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(' ')); line = [] }
    for (const it of items) {
      if (line.length && Math.abs(line[0].y - it.y) > 3) flush()
      line.push(it)
    }
    flush()
  }
  return out.join('\n')
}

// ---------- Rules ----------

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const LEGAL = /\b(n\.?v\.?|v\.?b\.?a\.?|llc|l\.l\.c|ltd|inc|c\.?a\.?|s\.?a\.?|s\.?r\.?l|corp|co)\b/g
const squash = (s: string) => strip(s).replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const GENERIC = new Set(['varios', 'otros', 'gastos', 'irwin perret acedo', 'irwin perret', 'poundwise investment development'])

function parseMoney(raw: string): number | null {
  const m = raw.match(/(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{2}))?$/)
  if (!m) return null
  const whole = m[1].replace(/[.,]/g, '')
  const n = Number(m[2] ? `${whole}.${m[2]}` : whole)
  return Number.isFinite(n) ? n : null
}

const MONEY_RE = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})(?!\d)/g

function pickAmount(lines: string[]): number | null {
  // Higher number = stronger wording. Within the same strength the last one wins,
  // since totals sit at the bottom of an invoice.
  const strong = /(balance due|amount due|total due|grand total|total a pagar|importe total|monto total|total amount|saldo a pagar|neto a pagar)/
  let best: { score: number; value: number } | null = null
  lines.forEach((raw, idx) => {
    const l = strip(raw)
    let score = 0
    if (strong.test(l)) score = 3
    else if (/(^|\s)total\b/.test(l) && !/(net|sub|tax|iva|btw|vat)\s*total|sub-?total|total\s*(tax|iva|btw|vat|items|qty|quantity)/.test(l)) score = 2
    if (!score) return
    // The figure is on the same line, or on the next one when the label stands alone.
    const nums = [...raw.matchAll(MONEY_RE)].map((m) => parseMoney(m[1])).filter((n): n is number => n !== null)
    const next = nums.length ? nums : [...(lines[idx + 1] ?? '').matchAll(MONEY_RE)].map((m) => parseMoney(m[1])).filter((n): n is number => n !== null)
    if (!next.length) return
    const value = next[next.length - 1]
    if (!best || score >= best.score) best = { score, value }
  })
  return best ? (best as { value: number }).value : null
}

function pickCurrency(text: string): InvoiceInfo['currency'] {
  const t = text
  if (/\b(AWG|AFL)\b|Afl\.?\s?\d|ƒ|florin/i.test(t)) return 'Florines'
  if (/\bEUR\b|€|\beuros?\b/i.test(t)) return 'Euros'
  if (/\bUSD\b|US\$|\$/i.test(t)) return 'Dólares'
  return null
}

function pickReference(text: string): string | null {
  const first = (re: RegExp) => [...text.matchAll(re)].map((m) => m[1]).find((v) => /\d/.test(v))
  const inv = first(/\b(?:invoice|factura|fact\.?|inv\.?)[ \t]*(?:no\.?|number|num(?:ero)?\.?|n[°º]|#)?[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9-]{2,})/gi)
  if (inv) return `Factura ${inv}`
  const ord = first(/\border[ \t]*(?:no\.?|number|#)[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9-]{2,})/gi)
  if (ord) return `Orden de compra ${ord}`
  return null
}

function pickContractor(text: string, known: KnownContractor[]): string | null {
  const body = ` ${squash(text)} `
  const lower = strip(text)
  let best: { name: string; score: number } | null = null
  for (const k of known) {
    const key = squash(k.name)
    if (key.length < 4 || GENERIC.has(key)) continue
    let score = 0
    if (k.email && lower.includes(strip(k.email))) score += 1000
    if (body.includes(` ${key} `)) score += 100 + key.length
    if (score && (!best || score + Math.log(1 + k.count) > best.score)) best = { name: k.name, score: score + Math.log(1 + k.count) }
  }
  return best?.name ?? null
}

export function extractInvoiceInfo(text: string, known: KnownContractor[]): InvoiceInfo {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return {
    contractor: pickContractor(text, known),
    amount: pickAmount(lines),
    currency: pickCurrency(text),
    reference: pickReference(text),
  }
}

import { unzipSync, strFromU8 } from 'fflate'

export type PaymentOrder = {
  id?: string
  project: string
  order_no: string
  order_date: string | null
  currency: string | null
  contractor: string | null
  discipline: string | null
  contract_code: string | null
  contract_date: string | null
  type: string | null
  concept: string | null
  contract_amount: number | null
  amount_requested: number | null
  balance_before: number | null
  advance_amort: number | null
  tax_type: string | null
  tax_amount: number | null
  tax_accum: number | null
  retentions: number | null
  retentions_accum: number | null
  net_to_pay: number | null
  paid_after: number | null
  remaining: number | null
  peticion: string | null
  status: string | null
  exchange_rate: number | null
  amount_usd: number | null
  advance_date: string | null
  phone: string | null
  email: string | null
  account: string | null
  comments: string | null
  pct_paid: number | null
  support_path?: string | null
  order_pdf_path?: string | null
  emailed_at?: string | null
}

export const PROJECTS = [{ value: 'HH', label: 'Harbour House (HH)' }]
export const CURRENCIES = ['Dólares', 'Florines', 'Euros']
export const PAYMENT_TYPES = ['ANTICIPO', 'VAL. PARCIAL', 'VAL. CIERRE', 'VAL. ÚNICA', 'VAL. FINAL', 'COMPRA', 'PRESTAMO']
export const TAX_TYPES = ['N/A', 'IVA', 'VAT']

const round2 = (n: number) => Math.round(n * 100) / 100
export const isAnticipo = (type: string | null) => (type ?? '').trim().toLowerCase() === 'anticipo'
export const taxRate = (taxType: string | null) => {
  const t = (taxType ?? '').trim().toUpperCase()
  return t === 'IVA' ? 0.12 : t === 'VAT' ? 0.06 : 0
}

// Next order number: the highest purely numeric one plus 1 (some very old
// orders have codes like "0105-A301", which are ignored here).
export function nextOrderNumber(history: Pick<PaymentOrder, 'order_no'>[]): string {
  let max = 0
  for (const h of history) if (/^\d+$/.test(h.order_no)) max = Math.max(max, Number(h.order_no))
  return String(max + 1)
}

export type OrderInputs = {
  contract_code: string
  contract_amount: number
  type: string
  amount_requested: number
  advance_amort: number
  tax_type: string
  retentions: number
}

// Same math as the Excel sheet, using the earlier orders of the same contract:
// balance before = paid so far (net of tax); tax and retentions accumulate;
// net to pay = requested - advance amortised + tax - retentions.
export function computeOrder(history: PaymentOrder[], i: OrderInputs) {
  const prior = history.filter((h) => h.contract_code === i.contract_code)
  const sum = (f: (h: PaymentOrder) => number | null) => prior.reduce((a, h) => a + (f(h) ?? 0), 0)
  const anticipo = isAnticipo(i.type)
  const balance_before = anticipo ? 0 : round2(sum((h) => h.net_to_pay) - sum((h) => h.tax_amount))
  const tax_amount = anticipo ? 0 : round2(i.amount_requested * taxRate(i.tax_type))
  const tax_accum = round2(sum((h) => h.tax_amount) + tax_amount)
  const retentions_accum = round2(sum((h) => h.retentions) + i.retentions)
  const net_to_pay = round2(i.amount_requested - i.advance_amort + tax_amount - i.retentions)
  const paid_after = round2(balance_before + i.amount_requested - i.advance_amort)
  const remaining = paid_after === 0 ? 0 : round2(i.contract_amount - paid_after)
  const pct_paid = i.contract_amount ? paid_after / i.contract_amount : 0
  return { balance_before, tax_amount, tax_accum, retentions_accum, net_to_pay, paid_after, remaining, pct_paid }
}

// ---------- Import of the history from the Excel workbook ----------

const COLS: Record<string, keyof PaymentOrder> = {
  B: 'order_no', C: 'order_date', D: 'currency', E: 'contractor', F: 'discipline', G: 'contract_code',
  H: 'contract_date', I: 'type', J: 'concept', K: 'contract_amount', L: 'amount_requested', M: 'balance_before',
  N: 'advance_amort', O: 'tax_type', P: 'tax_amount', Q: 'tax_accum', R: 'retentions', S: 'retentions_accum',
  T: 'net_to_pay', U: 'paid_after', V: 'remaining', W: 'peticion', X: 'status', Y: 'exchange_rate',
  Z: 'amount_usd', AC: 'advance_date', AD: 'phone', AE: 'email', AF: 'account', AG: 'comments', AH: 'pct_paid',
}
const NUMERIC = new Set<keyof PaymentOrder>([
  'contract_amount', 'amount_requested', 'balance_before', 'advance_amort', 'tax_amount', 'tax_accum', 'retentions',
  'retentions_accum', 'net_to_pay', 'paid_after', 'remaining', 'exchange_rate', 'amount_usd', 'pct_paid',
])
const DATES = new Set<keyof PaymentOrder>(['order_date', 'contract_date', 'advance_date'])

const unesc = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10)
}

// Reads the "PagosBH" sheet straight out of the .xlsm in the browser. Nothing is
// uploaded anywhere except the rows that are saved to your own database.
export function parsePagosWorkbook(buffer: ArrayBuffer, project: string): PaymentOrder[] {
  const files = unzipSync(new Uint8Array(buffer), {
    filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name),
  })
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '')

  const wb = text('xl/workbook.xml')
  const sheetTag = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => /name="PagosBH"/.test(t))
  const rid = sheetTag?.match(/r:id="([^"]+)"/)?.[1]
  if (!rid) throw new Error('No encontré la hoja "PagosBH" en el archivo.')
  const rels = text('xl/_rels/workbook.xml.rels')
  const relTag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`))
  const target = relTag?.match(/Target="([^"]+)"/)?.[1]
  if (!target) throw new Error('No pude ubicar la hoja de pagos dentro del archivo.')
  const sheetXml = text('xl/' + target.replace(/^\/?(xl\/)?/, ''))

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
  )

  const orders: PaymentOrder[] = []
  for (const rowM of sheetXml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (Number(rowM[1]) < 5) continue
    const raw: Record<string, string | number> = {}
    for (const c of rowM[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, attr, inner] = c
      const v = inner?.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      if (v === undefined) continue
      if (/t="s"/.test(attr)) raw[col] = shared[Number(v)] ?? ''
      else if (/t="(str|e)"/.test(attr)) raw[col] = unesc(v)
      else raw[col] = Number.isNaN(Number(v)) ? v : Number(v)
    }
    if (raw.B === undefined || raw.B === '') continue

    const o: Record<string, unknown> = { project }
    for (const [col, field] of Object.entries(COLS)) {
      const v = raw[col]
      if (v === undefined || v === '' || (typeof v === 'string' && v.startsWith('#'))) { o[field] = null; continue }
      if (field === 'order_no') o[field] = String(v).replace(/\.0$/, '')
      else if (DATES.has(field)) o[field] = typeof v === 'number' ? excelSerialToIso(v) : null
      else if (NUMERIC.has(field)) o[field] = typeof v === 'number' ? v : null
      else o[field] = String(v).trim() === '0' && (field === 'phone' || field === 'email') ? null : String(v)
    }
    orders.push(o as PaymentOrder)
  }
  return orders
}

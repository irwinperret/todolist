import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { loadSignature } from './orderPdf'
import type { PaymentOrder } from './payments'

// "Payment order" PDF for the Vermont (WRJ) project, laid out like its Excel
// template (Plant ESP): English labels, USD, no taxes, change orders and the
// category lines. The signature comes from the private table, not the repository.

const X = { a: 0, b: 186.1, c: 362.8, d: 529.6, e: 672, end: 790.4 }
const ROW = 42.87
const H = { top: 128.6, spacer: 42, comments: 51.3, account: 170, signature: 146 }

const BLACK = rgb(0, 0, 0)
const GREY = rgb(0.851, 0.851, 0.851)
const LIGHT_GREY = rgb(0.933, 0.933, 0.933)
const GREEN = rgb(0.886, 0.937, 0.855)
const YELLOW = rgb(1, 0.949, 0.8)
const NAVY = rgb(0.12, 0.2, 0.4)
const RED = rgb(0.8, 0, 0)

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d}-${MONTHS[m - 1]}-${String(y).slice(2)}`
}
function usd(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-$${abs}` : `$${abs}`
}

export async function buildVtOrderPdf(o: PaymentOrder): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const signature = await pdf.embedPng(await loadSignature())

  const s = 0.58
  const boxW = X.end * s
  const left = (595.28 - boxW) / 2
  const top = 841.89 - 45

  type Row = { h: number; div?: number; fill?: ReturnType<typeof rgb>; fillFrom?: number }
  const rows: Record<string, Row> = {
    top: { h: H.top },
    title: { h: ROW, fill: GREY },
    project: { h: ROW, div: X.b }, vendor: { h: ROW, div: X.b }, contract: { h: ROW, div: X.b }, balance: { h: ROW, div: X.b },
    proforma: { h: ROW },
    yellow: { h: ROW, div: X.b, fill: YELLOW },
    desc: { h: ROW, div: X.b, fill: GREY }, amount: { h: ROW, div: X.b, fill: GREY }, withheld: { h: ROW, div: X.b, fill: GREY },
    total: { h: ROW, div: X.b, fill: GREY },
    gap1: { h: H.spacer },
    email: { h: ROW, div: X.c },
    comments: { h: H.comments, div: X.c, fill: LIGHT_GREY },
    account: { h: H.account, div: X.c },
    gap2: { h: ROW },
    quote: { h: ROW, div: X.c }, paid: { h: ROW, div: X.c }, remaining: { h: ROW, div: X.c },
    sign: { h: H.signature, div: X.c },
  }
  const order = Object.keys(rows)
  const yTop: Record<string, number> = {}
  let acc = 0
  for (const k of order) { yTop[k] = acc; acc += rows[k].h }
  const totalH = acc

  const px = (x: number) => left + x * s
  const py = (y: number) => top - y * s

  for (const k of order) {
    const r = rows[k]
    if (r.fill) page.drawRectangle({ x: px(0), y: py(yTop[k] + r.h), width: boxW, height: r.h * s, color: r.fill })
  }
  page.drawRectangle({ x: px(X.d), y: py(yTop.proforma + ROW), width: (X.end - X.d) * s, height: ROW * s, color: GREEN })
  const line = (x1: number, y1: number, x2: number, y2: number, t = 0.6) =>
    page.drawLine({ start: { x: px(x1), y: py(y1) }, end: { x: px(x2), y: py(y2) }, thickness: t, color: BLACK })
  for (const k of order) {
    if (k === 'top') continue
    line(0, yTop[k] + rows[k].h, X.end, yTop[k] + rows[k].h)
    if (rows[k].div !== undefined) line(rows[k].div!, yTop[k], rows[k].div!, yTop[k] + rows[k].h)
  }
  line(0, yTop.title, X.end, yTop.title)
  for (const k of ['project', 'vendor', 'contract', 'balance', 'proforma']) line(X.d, yTop[k], X.d, yTop[k] + ROW)
  line(0, 0, X.end, 0, 1.4); line(0, totalH, X.end, totalH, 1.4); line(0, 0, 0, totalH, 1.4); line(X.end, 0, X.end, totalH, 1.4)

  const clean = (f: PDFFont, t: string) => {
    const ok = new Set(f.getCharacterSet())
    return [...t.normalize('NFC')].map((ch) => (ch === '\n' || ok.has(ch.codePointAt(0)!) ? ch : '?')).join('')
  }
  const wrap = (f: PDFFont, size: number, text: string, maxW: number): string[] => {
    const out: string[] = []
    for (const para of clean(f, text).split('\n')) {
      let cur = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word
        if (f.widthOfTextAtSize(next, size) <= maxW || !cur) cur = next
        else { out.push(cur); cur = word }
      }
      out.push(cur)
    }
    return out
  }
  const put = (key: string, x0: number, x1: number, text: string, opt: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; min?: number } = {}) => {
    if (!text) return
    const f = opt.bold ? bold : regular
    const cellW = (x1 - x0) * s - 8
    const cellH = rows[key].h * s - 4
    let size = opt.size ?? 8.5
    let lines = wrap(f, size, text, cellW)
    while (lines.length * size * 1.18 > cellH && size > (opt.min ?? 5.5)) { size -= 0.4; lines = wrap(f, size, text, cellW) }
    const lh = size * 1.18
    let y = py(yTop[key]) - (rows[key].h * s - lines.length * lh) / 2 - size * 0.85
    for (const l of lines) {
      const w = f.widthOfTextAtSize(l, size)
      page.drawText(l, { x: px((x0 + x1) / 2) - w / 2, y, size, font: f, color: opt.color ?? BLACK })
      y -= lh
    }
  }

  const small = 6.6, big = 8.2
  put('title', X.a, X.c, 'PAYMENT ORDER', { bold: true, size: 9.5 })
  put('title', X.c, X.e, 'No.', { bold: true, size: 9.5 })
  put('title', X.e, X.end, /^\d+$/.test(o.order_no) ? o.order_no.padStart(4, '0') : o.order_no, { bold: true, size: 9.5 })

  const pgm = o.project === 'PGM'
  put('project', X.a, X.b, 'Project', { size: small }); put('project', X.b, X.d, pgm ? 'PGM Construction - General Aruba' : 'Green Heights Multifamily', { bold: true, size: 7.2, color: NAVY })
  put('project', X.d, X.e, 'Date', { size: small }); put('project', X.e, X.end, shortDate(o.order_date), { size: small })
  put('vendor', X.a, X.b, 'Proveedor:', { size: small }); put('vendor', X.b, X.d, o.contractor ?? '', { bold: true, size: 7.2 })
  put('vendor', X.d, X.e, 'Contact', { size: small }); put('vendor', X.e, X.end, o.phone ?? '', { size: small })
  put('contract', X.a, X.b, 'Contrato/Presupuesto:', { size: small }); put('contract', X.b, X.d, o.contract_code ?? '', { bold: true, size: 7.2 })
  put('contract', X.d, X.e, 'Quote Date', { size: small }); put('contract', X.e, X.end, shortDate(o.advance_date), { size: small })
  put('balance', X.a, X.b, 'Saldo antes de Pago', { size: small }); put('balance', X.b, X.d, usd(o.balance_before), { bold: true, size: 7.2 })
  put('balance', X.d, X.e, 'Accounting cat', { size: small }); put('balance', X.e, X.end, o.category_n1 ?? '', { size: 5.8, min: 4.5 })
  put('proforma', X.d, X.e, 'Proforma cat', { size: small }); put('proforma', X.e, X.end, o.category_n2 ?? '', { size: 5.8, min: 4.5 })

  if (pgm) { put('yellow', X.a, X.b, 'Moneda', { size: small }); put('yellow', X.b, X.end, o.currency ?? 'Dólares', { bold: true, size: big }) }
  put('desc', X.a, X.b, 'Description', { size: big }); put('desc', X.b, X.end, o.concept ?? '', { size: big })
  put('amount', X.a, X.b, 'Amount', { size: big }); put('amount', X.b, X.end, usd(o.amount_requested), { size: big })
  put('withheld', X.a, X.b, 'Withheld', { size: big }); put('withheld', X.b, X.end, usd(o.retentions), { size: big })
  put('total', X.a, X.b, 'Total Amount', { bold: true, size: big }); put('total', X.b, X.end, usd(o.net_to_pay), { bold: true, size: big })

  put('email', X.a, X.c, 'Email beneficiary', { size: big }); put('email', X.c, X.end, o.email ?? '', { size: 7.2 })
  put('comments', X.a, X.c, 'Additional comments', { size: big, color: RED }); put('comments', X.c, X.end, o.comments ?? '', { size: 6, color: RED, min: 4.5 })
  put('account', X.a, X.c, 'Payment instructions (Bank Account)', { size: big }); put('account', X.c, X.end, o.account ?? '', { size: 7.4, min: 4.5 })

  put('quote', X.a, X.c, 'Quote/contract + Change Orders Total', { size: small }); put('quote', X.c, X.end, usd((o.contract_amount ?? 0) + (o.extra_amount ?? 0)), { bold: true, size: 8 })
  put('paid', X.a, X.c, 'Amount paid to date from quote/contract (including this payment and cumulative withholdings)', { size: small }); put('paid', X.c, X.end, usd(o.paid_after), { bold: true, size: 8 })
  put('remaining', X.a, X.c, 'Amount remaining to date from quote/contract (including this payment and cumulative withholdings)', { size: small }); put('remaining', X.c, X.end, usd(o.remaining), { bold: true, size: 8 })

  put('sign', X.a, X.c, 'GPA Management / Black Rock Investments', { bold: true, size: small })
  const w = 114 * 0.6, h = 64 * 0.6
  page.drawImage(signature, { x: px((X.c + X.end) / 2) - w / 2, y: py(yTop.sign + H.signature / 2) - h / 2, width: w, height: h })

  return pdf.save()
}

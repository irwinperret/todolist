import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import logoUrl from '../assets/hh-logo.png?url'
import { supabase } from './supabase'
import type { PaymentOrder } from './payments'

// Builds the "Orden de Pago" PDF with the same layout as the Excel template
// (Plant ESP): logo, order data, amounts, comments, bank account, accumulated
// totals and signature. The signature image is read from a private table, never
// from the (public) code repository.

const CLIENT: Record<string, string> = { HH: 'Poundwise Investment & Development VBA' }
const SIGNER = 'Ing. Irwin Perret Acedo\nCI 17.348.918\nCIV: 291442'

// Template column edges and row heights, in the template's own pixel units.
const X = { a: 0, b: 185.7, c: 361.9, d: 528.5, e: 670.9, end: 790.4 }
const ROW = 42.87
const H = { logo: 128.6, spacer: 42, account: 170, signature: 96 }

const BLACK = rgb(0, 0, 0)
const GREY = rgb(0.851, 0.851, 0.851)
const LIGHT_GREY = rgb(0.933, 0.933, 0.933)
const GREEN = rgb(0.886, 0.937, 0.855)
const ORANGE = rgb(0.984, 0.898, 0.839)
const BLUE = rgb(0.871, 0.918, 0.965)
const RED = rgb(0.8, 0, 0)

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function shortDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d}-${MONTHS[m - 1]}-${String(y).slice(2)}`
}

function money(n: number | null | undefined, currency: string | null): string {
  const v = Number(n ?? 0)
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const prefix = currency === 'Florines' ? 'AFL ' : currency === 'Euros' ? '€' : '$'
  return v < 0 ? `-${prefix}${abs}` : `${prefix}${abs}`
}

async function loadSignature(): Promise<Uint8Array> {
  const { data, error } = await supabase.from('app_assets').select('data').eq('name', 'firma_png_base64').single()
  if (error || !data) throw new Error('No pude cargar la firma para la orden.')
  const bin = atob((data as { data: string }).data)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export async function buildOrderPdf(o: PaymentOrder): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await pdf.embedPng(await (await fetch(logoUrl)).arrayBuffer())
  const signature = await pdf.embedPng(await loadSignature())

  const s = 0.58 // template px -> pdf points
  const boxW = X.end * s
  const left = (595.28 - boxW) / 2
  const top = 841.89 - 45

  // Rows from top to bottom: height and (optional) vertical divider and fill.
  type Row = { h: number; div?: number; fill?: ReturnType<typeof rgb> }
  const currencyFill = o.currency === 'Florines' ? ORANGE : o.currency === 'Euros' ? BLUE : GREEN
  const rows: Record<string, Row> = {
    logo: { h: H.logo },
    title: { h: ROW, fill: GREY },
    cliente: { h: ROW, div: X.b }, proveedor: { h: ROW, div: X.b }, contrato: { h: ROW, div: X.b }, saldo: { h: ROW, div: X.b },
    gap1: { h: H.spacer },
    moneda: { h: ROW, div: X.b, fill: currencyFill },
    concepto: { h: ROW, div: X.b, fill: GREY }, monto: { h: ROW, div: X.b, fill: GREY }, amort: { h: ROW, div: X.b, fill: GREY },
    iva: { h: ROW, div: X.b, fill: GREY }, total: { h: ROW, div: X.b, fill: GREY },
    gap2: { h: H.spacer },
    email: { h: ROW, div: X.c }, comentarios: { h: ROW, div: X.c, fill: LIGHT_GREY }, cuenta: { h: H.account, div: X.c },
    gap3: { h: ROW },
    estimado: { h: ROW, div: X.c }, pagado: { h: ROW, div: X.c }, impuestos: { h: ROW, div: X.c }, retenciones: { h: ROW, div: X.c },
    firma: { h: H.signature, div: X.c },
  }
  const order = Object.keys(rows)
  const yTop: Record<string, number> = {}
  let acc = 0
  for (const k of order) { yTop[k] = acc; acc += rows[k].h }
  const totalH = acc

  const px = (x: number) => left + x * s
  const py = (y: number) => top - y * s

  // Fills first, then lines on top.
  for (const k of order) {
    const r = rows[k]
    if (r.fill) page.drawRectangle({ x: px(0), y: py(yTop[k] + r.h), width: boxW, height: r.h * s, color: r.fill })
  }
  const line = (x1: number, y1: number, x2: number, y2: number, t = 0.6) =>
    page.drawLine({ start: { x: px(x1), y: py(y1) }, end: { x: px(x2), y: py(y2) }, thickness: t, color: BLACK })
  for (const k of order) {
    line(0, yTop[k] + rows[k].h, X.end, yTop[k] + rows[k].h)
    if (rows[k].div !== undefined) line(rows[k].div!, yTop[k], rows[k].div!, yTop[k] + rows[k].h)
  }
  for (const k of ['cliente', 'proveedor', 'contrato', 'saldo']) line(X.d, yTop[k], X.d, yTop[k] + ROW)
  // Outer frame.
  line(0, 0, X.end, 0, 1.4); line(0, totalH, X.end, totalH, 1.4); line(0, 0, 0, totalH, 1.4); line(X.end, 0, X.end, totalH, 1.4)

  // ---- text helpers ----
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
  // Draws text centred in the cell x0..x1 of the given row; shrinks to fit.
  const put = (key: string, x0: number, x1: number, text: string, opt: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; min?: number } = {}) => {
    if (!text) return
    const f = opt.bold ? bold : regular
    const cellW = (x1 - x0) * s - 8
    const cellH = rows[key].h * s - 4
    let size = opt.size ?? 8.5
    let lines = wrap(f, size, text, cellW)
    while (lines.length * size * 1.18 > cellH && size > (opt.min ?? 5.5)) { size -= 0.4; lines = wrap(f, size, text, cellW) }
    const lh = size * 1.18
    const blockH = lines.length * lh
    let y = py(yTop[key]) - (rows[key].h * s - blockH) / 2 - size * 0.85
    for (const l of lines) {
      const w = f.widthOfTextAtSize(l, size)
      page.drawText(l, { x: px((x0 + x1) / 2) - w / 2, y, size, font: f, color: opt.color ?? BLACK })
      y -= lh
    }
  }

  // ---- logo (same placement as the template) ----
  const logoW = 495 * s, logoH = (logoW * 236) / 1000
  page.drawImage(logo, { x: px(154.5), y: py(9.5) - logoH, width: logoW, height: logoH })

  // ---- header ----
  put('title', X.a, X.c, 'ORDEN   DE   PAGO', { bold: true, size: 9.5 })
  put('title', X.c, X.e, 'No.', { bold: true, size: 9.5 })
  put('title', X.e, X.end, /^\d+$/.test(o.order_no) ? o.order_no.padStart(4, '0') : o.order_no, { bold: true, size: 9.5 })

  const small = 6.6
  put('cliente', X.a, X.b, 'Cliente:', { size: small }); put('cliente', X.b, X.d, CLIENT[o.project] ?? '', { bold: true, size: small })
  put('cliente', X.d, X.e, 'Fecha de la Orden:', { size: small }); put('cliente', X.e, X.end, shortDate(o.order_date), { size: small })
  put('proveedor', X.a, X.b, 'Proveedor:', { size: small }); put('proveedor', X.b, X.d, o.contractor ?? '', { bold: true, size: 7.2 })
  put('proveedor', X.d, X.e, 'Telefono de Contacto:', { size: small }); put('proveedor', X.e, X.end, o.phone ?? '', { size: small })
  put('contrato', X.a, X.b, 'Contrato/Presupuesto:', { size: small }); put('contrato', X.b, X.d, o.contract_code ?? '', { bold: true, size: 7.2 })
  put('contrato', X.d, X.e, 'Fecha de Presupuesto:', { size: small }); put('contrato', X.e, X.end, shortDate(o.contract_date), { size: small })
  put('saldo', X.a, X.b, 'Saldo antes de Pago', { size: small }); put('saldo', X.b, X.d, money(o.balance_before, o.currency), { bold: true, size: 7.2 })
  put('saldo', X.d, X.e, 'Fecha del Anticipo:', { size: small }); put('saldo', X.e, X.end, shortDate(o.advance_date), { size: small })

  // ---- amounts ----
  const big = 8.2
  put('moneda', X.a, X.b, 'Moneda', { size: big }); put('moneda', X.b, X.end, o.currency ?? '', { size: big })
  put('concepto', X.a, X.b, 'Concepto del Pago', { size: big }); put('concepto', X.b, X.end, o.concept ?? '', { size: big })
  put('monto', X.a, X.b, 'Monto base del Pago', { size: big }); put('monto', X.b, X.end, money(o.amount_requested, o.currency), { size: big })
  put('amort', X.a, X.b, 'Amortizacion Anticipo', { size: big }); put('amort', X.b, X.end, money(o.advance_amort, o.currency), { size: big })
  put('iva', X.a, X.b, 'IVA/VBO menos Retenciones', { size: big }); put('iva', X.b, X.end, money((o.tax_amount ?? 0) - (o.retentions ?? 0), o.currency), { size: big })
  put('total', X.a, X.b, 'Total a Pagar', { bold: true, size: big }); put('total', X.b, X.end, money(o.net_to_pay, o.currency), { bold: true, size: big })

  // ---- beneficiary ----
  put('email', X.a, X.c, 'Email Beneficiario', { size: big }); put('email', X.c, X.end, o.email ?? '', { size: 7.2 })
  put('comentarios', X.a, X.c, 'Comentarios adicionales', { size: big, color: RED }); put('comentarios', X.c, X.end, o.comments ?? '', { size: 5.8, color: RED, min: 4.5 })
  put('cuenta', X.a, X.c, 'o Depositar en cuenta N°', { size: big }); put('cuenta', X.c, X.end, o.account ?? '', { size: 7.4, min: 4.5 })

  // ---- accumulated totals ----
  put('estimado', X.a, X.c, 'Estimado total presupuesto', { size: small }); put('estimado', X.c, X.end, money(o.contract_amount, o.currency), { bold: true, size: 8 })
  put('pagado', X.a, X.c, 'Total pagado de este presupuesto, luego de este pago:', { size: small }); put('pagado', X.c, X.end, money(o.paid_after, o.currency), { bold: true, size: 8 })
  put('impuestos', X.a, X.c, 'Impuestos ya abonados de este pres, luego de este pago:', { size: small }); put('impuestos', X.c, X.end, money(o.tax_accum, o.currency), { bold: true, size: 8 })
  put('retenciones', X.a, X.c, 'Retenciones acumuladas de este pres. luego de este pago:', { size: small }); put('retenciones', X.c, X.end, money(o.retentions_accum, o.currency), { bold: true, size: 8 })

  // ---- signature block ----
  put('firma', X.a, X.c, 'Por Pering Austral:', { bold: true, size: small })
  drawSignature(page, signature, px, py, yTop.firma, s, regular, SIGNER)

  return pdf.save()
}

function drawSignature(page: PDFPage, img: PDFImage, px: (x: number) => number, py: (y: number) => number, yTop: number, s: number, font: PDFFont, signer: string) {
  const w = 114 * 0.85 * s, h = 64 * 0.85 * s
  const cx = px((X.c + X.end) / 2)
  page.drawImage(img, { x: cx - w / 2, y: py(yTop + 4) - h, width: w, height: h })
  let y = py(yTop + 4) - h - 6
  for (const l of signer.split('\n')) {
    const tw = font.widthOfTextAtSize(l, 6)
    page.drawText(l, { x: cx - tw / 2, y, size: 6, font, color: BLACK })
    y -= 6.6
  }
}

// Edits the Excel workbooks (.xlsm) that hold the payment history, by changing their
// XML directly, so macros, formats and everything else in the file stay untouched.
// It only ever (1) fills in the next empty row of the payments sheet and (2) for
// Harbour House, adds the order's tab as a copy of the latest order tab.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

export type SyncOrder = {
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
  extra_amount: number | null
  amount_requested: number | null
  advance_amort: number | null
  tax_type: string | null
  retentions: number | null
  exchange_rate: number | null
  status: string | null
  phone: string | null
  email: string | null
  account: string | null
  comments: string | null
  category_n1: string | null
  category_n2: string | null
}

type Cell = { kind: 'n'; v: number } | { kind: 's'; v: string } | { kind: 'f'; v: string }
const num = (v: number | null | undefined): Cell | null => (v === null || v === undefined || Number.isNaN(v) ? null : { kind: 'n', v })
const str = (v: string | null | undefined): Cell | null => (v && v.trim() ? { kind: 's', v } : null)
const fx = (v: string): Cell => ({ kind: 'f', v })

export function excelDate(iso: string | null): Cell | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return { kind: 'n', v: Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569 }
}

const colNum = (c: string) => [...c].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// What goes in each column of the payments sheet for one order. Columns that hold
// formulas in the workbook get the same formula for the new row (Excel calculates).
export function rowCells(o: SyncOrder, r: number): Record<string, Cell | null> {
  const orderNo = /^\d+$/.test(o.order_no) ? num(Number(o.order_no)) : str(o.order_no)
  const p = r - 1
  if (o.project === 'VT') {
    return {
      B: orderNo, C: excelDate(o.order_date), E: str(o.contractor), G: str(o.category_n1), H: str(o.category_n2),
      I: str(o.contract_code), J: str(o.concept), K: num(o.contract_amount), L: num(o.extra_amount ?? 0), M: num(o.amount_requested),
      N: fx(`IFERROR(SUMIF(I$4:I${p},I${r},R$4:R${p}),0)`),
      O: fx(`N${r}-(P${r}-Q${r})`),
      P: num(o.retentions ?? 0),
      Q: fx(`SUMIF(I$4:I${p},I${r},P$4:P${p})+P${r}`),
      R: fx(`M${r}-P${r}`),
      S: fx(`R${r}+N${r}`),
      T: fx(`IF(S${r}=0,0,K${r}+L${r}-S${r})`),
      V: fx(`C${r}`),
      W: fx(`IFERROR(VLOOKUP(I${r},I$4:W${p},16,0),C${r})`),
      X: str(o.phone), Y: str(o.email), Z: str(o.account), AA: str(o.comments),
      AB: fx(`IFERROR(+S${r}/K${r},"")`),
      AC: fx(`IFERROR(+S${r}/(K${r}+L${r}),"")`),
    }
  }
  return {
    B: orderNo, C: excelDate(o.order_date), D: str(o.currency), E: str(o.contractor), F: str(o.discipline), G: str(o.contract_code),
    H: excelDate(o.contract_date), I: str(o.type), J: str(o.concept), K: num(o.contract_amount), L: num(o.amount_requested),
    M: fx(`IF(I${r}="anticipo",0,IFERROR(SUMIF(G$4:G${p},G${r},T$4:T${p})-SUMIF(G$4:G${p},G${r},P$4:P${p}),0))`),
    N: num(o.advance_amort ?? 0), O: str(o.tax_type ?? 'N/A'),
    P: fx(`IF(I${r}="anticipo",0,IF(O${r}="IVA",L${r}*12%,IF(O${r}="VAT",L${r}*6%,0)))`),
    Q: fx(`SUMIF(G$4:G${p},G${r},P$4:P${p})+P${r}`),
    R: num(o.retentions ?? 0),
    S: fx(`SUMIF(G$4:G${p},G${r},R$4:R${p})+R${r}`),
    T: fx(`L${r}-N${r}+P${r}-R${r}`),
    U: fx(`IF(I${r}="compra",T${r}-P${r},IF(I${r}="anticipo",L${r},IF(OR(I${r}="val. Parcial",I${r}="VAL. CIERRE")=TRUE,M${r}+T${r}-P${r},IF(I${r}="val. única",T${r}-P${r},T${r}-M${r}-P${r}))))`),
    V: fx(`IF(U${r}=0,0,K${r}-U${r})`),
    X: str(o.status ?? 'Solicitado'), Y: num(o.exchange_rate),
    Z: fx(`IFERROR(IF(D${r}="dólares",T${r},IF(D${r}="Florines",T${r}/1.79,IF(D${r}="Euros",T${r}*1.2,T${r}*Y${r})))*(IF(E${r}="PGM Condobuilders",-1,1)),"-")`),
    AB: fx(`C${r}`),
    AC: fx(`IFERROR(IF(I${r}="anticipo","-",VLOOKUP(G${r},G$4:AC${p},22,0)),"")`),
    AD: str(o.phone), AE: str(o.email), AF: str(o.account), AG: str(o.comments),
    AH: fx(`+U${r}/K${r}`),
  }
}

// ---- row editing inside a sheet's XML ----

function findRow(xml: string, r: number): { start: number; end: number; tag: string; inner: string } | null {
  const start = xml.indexOf(`<row r="${r}"`)
  if (start < 0) return null
  const tagEnd = xml.indexOf('>', start)
  const tag = xml.slice(start, tagEnd + 1)
  if (tag.endsWith('/>')) return { start, end: tagEnd + 1, tag, inner: '' }
  const close = xml.indexOf('</row>', tagEnd)
  return { start, end: close + 6, tag, inner: xml.slice(tagEnd + 1, close) }
}

const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g

function styleOf(attrs: string): string | null {
  return attrs.match(/\bs="(\d+)"/)?.[1] ?? null
}

function cellXml(col: string, r: number, c: Cell, s: string | null): string {
  const sa = s ? ` s="${s}"` : ''
  if (c.kind === 'n') return `<c r="${col}${r}"${sa}><v>${c.v}</v></c>`
  if (c.kind === 'f') return `<c r="${col}${r}"${sa}><f>${esc(c.v)}</f></c>`
  return `<c r="${col}${r}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`
}

// Which row to fill: the row already numbered with this order (column A) whose B is
// empty, or else the row right after the last order.
export function findTargetRow(xml: string, orderNo: string): { row: number; exists: boolean } {
  let lastB = 0
  for (const m of xml.matchAll(/<c r="B(\d+)"[^>]*?>(?:<f[^>]*>[^<]*<\/f>|<f[^>]*\/>)?<v>([^<]+)<\/v><\/c>/g)) {
    const v = unesc(m[2])
    if (v !== '' && v !== '0') {
      lastB = Math.max(lastB, Number(m[1]))
      if (v === orderNo && Number(m[1]) >= 5) return { row: Number(m[1]), exists: true }
    }
  }
  // inline / shared-string order numbers are rare; the numeric check above covers the sheets in use.
  const a = new RegExp(`<c r="A(\\d+)"[^>]*><v>${orderNo.replace(/[^0-9A-Za-z-]/g, '')}</v></c>`, 'g')
  for (const m of xml.matchAll(a)) {
    const r = Number(m[1])
    if (r > lastB) return { row: r, exists: false }
  }
  return { row: lastB + 1, exists: false }
}

export function fillRow(xml: string, o: SyncOrder, r: number): string {
  const cells = rowCells(o, r)
  const prev = findRow(xml, r - 1)
  const prevStyle = new Map<string, string>()
  if (prev) for (const m of prev.inner.matchAll(cellRe)) { const s = styleOf(m[3]); if (s) prevStyle.set(m[1], s) }

  const row = findRow(xml, r)
  const existing = new Map<string, { xml: string; s: string | null }>()
  if (row) for (const m of row.inner.matchAll(cellRe)) existing.set(m[1], { xml: m[0], s: styleOf(m[3]) })

  for (const [col, c] of Object.entries(cells)) {
    if (!c) continue
    existing.set(col, { xml: cellXml(col, r, c, existing.get(col)?.s ?? prevStyle.get(col) ?? null), s: null })
  }
  const body = [...existing.entries()].sort((a, b) => colNum(a[0]) - colNum(b[0])).map(([, v]) => v.xml).join('')
  const open = row ? row.tag.replace(/\s+spans="[^"]*"/, '').replace(/\/>$/, '>') : `<row r="${r}">`
  const rowXml = `${open}${body}</row>`
  if (row) return xml.slice(0, row.start) + rowXml + xml.slice(row.end)
  // Row does not exist: insert it in order.
  let pos = xml.indexOf('</sheetData>')
  for (const m of xml.matchAll(/<row r="(\d+)"/g)) if (Number(m[1]) > r) { pos = m.index!; break }
  return xml.slice(0, pos) + rowXml + xml.slice(pos)
}

// ---- workbook plumbing ----

const SHEET_NAME: Record<string, string> = { HH: 'PagosBH', VT: 'Pagos' }

function sheetPath(files: Record<string, Uint8Array>, name: string): { wb: string; path: string; index: number } {
  const wb = strFromU8(files['xl/workbook.xml'])
  const tags = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0])
  const index = tags.findIndex((t) => t.includes(`name="${name}"`))
  if (index < 0) throw new Error(`sheet_not_found:${name}`)
  const rid = tags[index].match(/r:id="([^"]+)"/)![1]
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'])
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`))!
  const target = rel.match(/Target="([^"]+)"/)![1]
  return { wb, path: 'xl/' + target.replace(/^\/?(xl\/)?/, ''), index }
}

// Adds the order's tab (Harbour House) as a copy of the latest order tab, placed
// just before the payments sheet, like the macro does.
function addOrderTab(files: Record<string, Uint8Array>, orderNo: string): string {
  const wbXml = strFromU8(files['xl/workbook.xml'])
  const tags = [...wbXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0])
  const names = tags.map((t) => unesc(t.match(/name="([^"]*)"/)![1]))
  if (names.includes(orderNo)) return 'exists'
  const payIdx = names.indexOf('PagosBH')
  if (payIdx < 1) throw new Error('sheet_not_found:PagosBH')
  const srcTag = tags[payIdx - 1] // the latest order tab sits right before PagosBH
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'])
  const srcRid = srcTag.match(/r:id="([^"]+)"/)![1]
  const srcTarget = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${srcRid}"`))!.match(/Target="([^"]+)"/)![1]
  const srcSheet = 'xl/' + srcTarget.replace(/^\/?(xl\/)?/, '')
  const srcRelsPath = srcSheet.replace('worksheets/', 'worksheets/_rels/') + '.rels'
  if (!files[srcSheet] || !files[srcRelsPath]) throw new Error('template_tab_missing')

  // New unique names for the parts.
  let n = 1
  while (files[`xl/worksheets/sheet${n}.xml`]) n++
  let d = 1
  while (files[`xl/drawings/drawing${d}.xml`]) d++
  const newSheet = `xl/worksheets/sheet${n}.xml`
  const newRels = `xl/worksheets/_rels/sheet${n}.xml.rels`

  // Sheet XML: new order number, no stale cached results, no printer settings.
  let sx = strFromU8(files[srcSheet])
  sx = sx.replace(/<sheetPr codeName="[^"]*">/, '<sheetPr>').replace(/ tabSelected="1"/, '')
  sx = sx.replace(/ xr:uid="\{[0-9A-F-]+\}"/g, '')
  sx = sx.replace(/(<c r="E4"[^>]*?)(?: t="[a-z]+")?>[\s\S]*?<\/c>/, (_m, head: string) => `${head.replace(/ t="[a-z]+"/, '')}><v>${/^\d+$/.test(orderNo) ? orderNo : 0}</v></c>`)
  sx = sx.replace(/<c ([^>]*?)>(<f[\s\S]*?<\/f>|<f[^>]*\/>)<v>[\s\S]*?<\/v><\/c>/g, (_m, attrs: string, f: string) => `<c ${attrs.replace(/ t="[a-z]+"/, '')}>${f}</c>`)
  sx = sx.replace(/<c ([^>]*?)>(<f[\s\S]*?<\/f>|<f[^>]*\/>)<v\/><\/c>/g, (_m, attrs: string, f: string) => `<c ${attrs.replace(/ t="[a-z]+"/, '')}>${f}</c>`)
  sx = sx.replace(/ r:id="rId2"(?=\/>)/, '')
  files[newSheet] = strToU8(sx)

  // Rels: keep the drawing (pointing to a copy) and the hyperlink, drop printer settings.
  let rx = strFromU8(files[srcRelsPath])
  const drawingTarget = rx.match(/Target="\.\.\/drawings\/(drawing\d+\.xml)"/)![1]
  rx = rx.replace(/<Relationship [^>]*printerSettings[^>]*\/>/, '').replace(`../drawings/${drawingTarget}`, `../drawings/drawing${d}.xml`)
  files[newRels] = strToU8(rx)
  files[`xl/drawings/drawing${d}.xml`] = files[`xl/drawings/${drawingTarget}`]
  const drRels = `xl/drawings/_rels/${drawingTarget}.rels`
  if (files[drRels]) files[`xl/drawings/_rels/drawing${d}.xml.rels`] = files[drRels]

  // Content types.
  let ct = strFromU8(files['[Content_Types].xml'])
  ct = ct.replace('</Types>', `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`)
  files['[Content_Types].xml'] = strToU8(ct)

  // Workbook relationship and sheet entry.
  let rid = 1
  while (rels.includes(`Id="rId${rid}"`)) rid++
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    rels.replace('</Relationships>', `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`)
  )
  const maxId = Math.max(...tags.map((t) => Number(t.match(/sheetId="(\d+)"/)![1])))
  let wb2 = wbXml.replace(tags[payIdx], `<sheet name="${esc(orderNo)}" sheetId="${maxId + 1}" r:id="rId${rid}"/>${tags[payIdx]}`)
  // Sheets after the new one move one place to the right: fix sheet-scoped names.
  wb2 = wb2.replace(/localSheetId="(\d+)"/g, (_m, i: string) => `localSheetId="${Number(i) >= payIdx ? Number(i) + 1 : Number(i)}"`)
  files['xl/workbook.xml'] = strToU8(wb2)
  return 'added'
}

export type SyncResult = { bytes: Uint8Array; row: number; status: 'added' | 'already'; tab: 'added' | 'exists' | 'none' }

export function applyOrder(zip: Uint8Array, o: SyncOrder): SyncResult {
  const files = unzipSync(zip)
  const { path } = sheetPath(files, SHEET_NAME[o.project])
  const xml = strFromU8(files[path])
  const target = findTargetRow(xml, o.order_no)
  if (target.exists) return { bytes: zip, row: target.row, status: 'already', tab: 'none' }

  files[path] = strToU8(fillRow(xml, o, target.row))
  let tab: SyncResult['tab'] = 'none'
  if (o.project === 'HH') tab = addOrderTab(files, o.order_no) === 'added' ? 'added' : 'exists'

  return { bytes: finalize(files), row: target.row, status: 'added', tab }
}

// Let Excel recalculate everything when it opens the file, and rebuild its
// calculation chain (which would not know about the changed formulas).
function finalize(files: Record<string, Uint8Array>): Uint8Array {
  let wb = strFromU8(files['xl/workbook.xml'])
  wb = wb.replace(/<calcPr([^>]*?)\/>/, (m, a: string) => (a.includes('fullCalcOnLoad') ? m : `<calcPr${a} fullCalcOnLoad="1"/>`))
  files['xl/workbook.xml'] = strToU8(wb)
  if (files['xl/calcChain.xml']) {
    delete files['xl/calcChain.xml']
    files['[Content_Types].xml'] = strToU8(strFromU8(files['[Content_Types].xml']).replace(/<Override[^>]*calcChain[^>]*\/>/, ''))
    files['xl/_rels/workbook.xml.rels'] = strToU8(strFromU8(files['xl/_rels/workbook.xml.rels']).replace(/<Relationship [^>]*calcChain[^>]*\/>/, ''))
  }

  const out: Zippable = {}
  for (const [name, data] of Object.entries(files)) out[name] = [data, { level: /\.(png|jpe?g|bin)$/i.test(name) ? 0 : 6 }]
  return zipSync(out)
}

// ---- removing an order ----

export type RemoveResult = { bytes: Uint8Array; row: number | null; status: 'removed' | 'absent'; tab: 'removed' | 'kept' | 'none' }

// Empties the order's row (keeping only its sequence number in column A, like the
// unused rows below it) and, for Harbour House, deletes the order's tab unless some
// chart, table or formula still refers to it.
export function removeOrder(zip: Uint8Array, project: string, orderNo: string): RemoveResult {
  const files = unzipSync(zip)
  const { path } = sheetPath(files, SHEET_NAME[project])
  let xml = strFromU8(files[path])
  const target = findTargetRow(xml, orderNo)
  let row: number | null = null
  if (target.exists) {
    row = target.row
    const found = findRow(xml, row)!
    const a = [...found.inner.matchAll(cellRe)].find((m) => m[1] === 'A')
    const open = found.tag.replace(/\s+spans="[^"]*"/, '').replace(/\/>$/, '>')
    xml = xml.slice(0, found.start) + `${open}${a ? a[0] : ''}</row>` + xml.slice(found.end)
    files[path] = strToU8(xml)
  }
  const tab = project === 'HH' ? removeOrderTab(files, orderNo) : 'none'
  if (!target.exists && tab !== 'removed') return { bytes: zip, row: null, status: 'absent', tab }
  return { bytes: finalize(files), row, status: row !== null ? 'removed' : 'absent', tab }
}

function removeOrderTab(files: Record<string, Uint8Array>, orderNo: string): 'removed' | 'kept' | 'none' {
  const wbXml = strFromU8(files['xl/workbook.xml'])
  const tags = [...wbXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0])
  const names = tags.map((t) => unesc(t.match(/name="([^"]*)"/)![1]))
  const idx = names.indexOf(orderNo)
  const payIdx = names.indexOf('PagosBH')
  if (idx < 0 || payIdx < 0 || idx >= payIdx) return 'none'

  // Anything that still points at this tab means it stays.
  const needle = `'${orderNo}'!`
  for (const [name, data] of Object.entries(files)) {
    if (!/^xl\/(charts|pivotCache|pivotTables|worksheets|externalLinks)\/.*\.xml$/.test(name)) continue
    if (strFromU8(data).includes(needle)) return 'kept'
  }
  const ownNames = new RegExp(`<definedName[^>]*localSheetId="${idx}"[^>]*>[\\s\\S]*?</definedName>`, 'g')
  if (wbXml.replace(tags[idx], '').replace(ownNames, '').includes(needle)) return 'kept'

  const rid = tags[idx].match(/r:id="([^"]+)"/)![1]
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'])
  const relTag = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`))!
  const sheetFile = 'xl/' + relTag.match(/Target="([^"]+)"/)![1].replace(/^\/?(xl\/)?/, '')
  const relsFile = sheetFile.replace('worksheets/', 'worksheets/_rels/') + '.rels'
  const gone = [sheetFile, relsFile]
  if (files[relsFile]) {
    const dr = strFromU8(files[relsFile]).match(/Target="\.\.\/drawings\/(drawing\d+\.xml)"/)?.[1]
    if (dr) gone.push(`xl/drawings/${dr}`, `xl/drawings/_rels/${dr}.rels`)
  }
  let ct = strFromU8(files['[Content_Types].xml'])
  for (const g of gone) {
    delete files[g]
    ct = ct.replace(new RegExp(`<Override[^>]*PartName="/${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`), '')
  }
  files['[Content_Types].xml'] = strToU8(ct)
  files['xl/_rels/workbook.xml.rels'] = strToU8(rels.replace(relTag, ''))
  let wb2 = wbXml.replace(tags[idx], '')
  wb2 = wb2.replace(new RegExp(`<definedName[^>]*localSheetId="${idx}"[^>]*>[\\s\\S]*?</definedName>`, 'g'), '')
  wb2 = wb2.replace(/localSheetId="(\d+)"/g, (_m, i: string) => `localSheetId="${Number(i) > idx ? Number(i) - 1 : Number(i)}"`)
  files['xl/workbook.xml'] = strToU8(wb2)
  return 'removed'
}

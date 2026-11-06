import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import InlinePicker from './InlinePicker'
import { loadActiveRecipient, type PaymentRecipient } from './PaymentRecipients'
import { MAX_PDF_BYTES, deleteOrderFiles, excelLastOrder, sendOrderEmail, syncOrderToExcel, uploadOrderPdf } from '../lib/dropbox'
import { useFeedback } from '../lib/FeedbackContext'
import { extractInvoiceInfo, readPdfText, type InvoiceInfo, type KnownContractor } from '../lib/invoiceReader'
import {
  CURRENCIES, PAYMENT_TYPES, PROJECTS, TAX_TYPES, computeOrder, computeVtOrder, isVtLike, nextOrderNumber, parsePagosWorkbook, pgmUsd,
  type PaymentOrder,
} from '../lib/payments'

type Tab = 'new' | 'history' | 'import'

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (s: string) => {
  const n = Number(s.replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base bg-white'
const label = 'block text-xs font-medium text-gray-600 mb-1'

async function loadAll(project: string): Promise<PaymentOrder[]> {
  const out: PaymentOrder[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('project', project)
      .order('created_at', { ascending: true })
      .order('order_no', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    out.push(...((data as PaymentOrder[]) ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export default function PaymentsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('new')
  const [project, setProject] = useState('HH')
  const [history, setHistory] = useState<PaymentOrder[] | null>(null)
  const [loadError, setLoadError] = useState('')

  const reload = useCallback(async () => {
    try {
      setHistory(await loadAll(project))
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'No se pudo cargar el historial')
    }
  }, [project])

  useEffect(() => {
    setHistory(null)
    reload()
  }, [reload])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">💸 Pagos</h2>
          <button onClick={onClose} className="text-gray-500 text-xl leading-none px-2" aria-label="Cerrar">×</button>
        </div>

        <div className="px-4 pt-3">
          <label className={label}>Proyecto</label>
          <InlinePicker value={project} placeholder="Proyecto" options={PROJECTS} onChange={setProject} />
          <div className="flex gap-2 mt-3 text-sm">
            {([['new', 'Nueva orden'], ['history', 'Historial'], ['import', 'Importar Excel']] as [Tab, string][]).map(([k, t]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-full border ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 overflow-y-auto">
          {loadError && <p className="text-red-600 text-sm mb-2">{loadError}</p>}
          {history === null && !loadError && <p className="text-gray-500 text-sm py-6 text-center">Cargando historial…</p>}
          {history !== null && tab === 'new' && <NewOrder key={project} project={project} history={history} onSaved={reload} />}
          {history !== null && tab === 'history' && <History history={history} project={project} onChanged={reload} />}
          {history !== null && tab === 'import' && <ImportExcel project={project} existing={history.length} onDone={reload} />}
        </div>
      </div>
    </div>
  )
}

function NewOrder({ project, history, onSaved }: { project: string; history: PaymentOrder[]; onSaved: () => Promise<void> }) {
  const [contractor, setContractor] = useState('')
  const [newContractor, setNewContractor] = useState('')
  const [contractCode, setContractCode] = useState('')
  const [newContract, setNewContract] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [currency, setCurrency] = useState('Dólares')
  const [type, setType] = useState('VAL. PARCIAL')
  const [concept, setConcept] = useState('')
  const [contractAmount, setContractAmount] = useState('')
  const [contractDate, setContractDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [advance, setAdvance] = useState('0')
  const [taxType, setTaxType] = useState('N/A')
  const [retentions, setRetentions] = useState('0')
  const [extra, setExtra] = useState('0')
  const [catN1, setCatN1] = useState('')
  const [catN2, setCatN2] = useState('')
  const [rate, setRate] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [account, setAccount] = useState('')
  const [comments, setComments] = useState('')
  const [support, setSupport] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  const [invoiceNote, setInvoiceNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [recipient, setRecipient] = useState<PaymentRecipient | null | undefined>(undefined)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    loadActiveRecipient(project).then(setRecipient)
  }, [project])

  const isVt = isVtLike(project)
  const isPgm = project === 'PGM'
  const isNewContractor = contractor === '__new__'
  const isNewContract = contractCode === '__new__'
  const contractorName = isNewContractor ? newContractor.trim() : contractor
  const code = isNewContract ? newContract.trim() : contractCode

  // Most recent orders first, so prefilled data (account, email) is the latest known.
  const recent = useMemo(() => [...history].reverse(), [history])
  const contractors = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const h of recent) if (h.contractor && !seen.has(h.contractor)) { seen.add(h.contractor); out.push(h.contractor) }
    return out
  }, [recent])
  const contracts = useMemo(() => {
    const seen = new Set<string>()
    const out: PaymentOrder[] = []
    for (const h of recent) {
      if (h.contractor === contractor && h.contract_code && !seen.has(h.contract_code)) { seen.add(h.contract_code); out.push(h) }
    }
    return out
  }, [recent, contractor])

  // The Excel is also checked, so a number already used there (e.g. added by hand) is skipped.
  const [excelMax, setExcelMax] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    excelLastOrder(project).then((m) => { if (alive) setExcelMax(m) })
    return () => { alive = false }
  }, [project])
  const fromHistory = nextOrderNumber(history)
  const orderNo = excelMax !== null && excelMax + 1 > Number(fromHistory) ? String(excelMax + 1) : fromHistory
  const excelAhead = orderNo !== fromHistory

  const known = useMemo<KnownContractor[]>(() => {
    const map = new Map<string, KnownContractor>()
    for (const h of recent) {
      if (!h.contractor) continue
      const k = map.get(h.contractor)
      if (k) k.count++
      else map.set(h.contractor, { name: h.contractor, count: 1, email: h.email })
    }
    return [...map.values()]
  }, [recent])

  // Fills only what is still empty from what was read in the invoice; nothing is saved.
  const applyInvoice = (info: InvoiceInfo) => {
    const got: string[] = []
    if (info.contractor && !contractor) {
      pickContractor(info.contractor)
      got.push(`contratista ${info.contractor}`)
      const lastContract = recent.find((h) => h.contractor === info.contractor && h.contract_code)?.contract_code
      if (lastContract && !contractCode) {
        pickContract(lastContract, info.contractor)
        got.push(`contrato ${lastContract} (el más reciente de ese contratista, verifícalo)`)
      }
    }
    if (info.amount && !num(amount)) {
      setAmount(String(info.amount))
      got.push(`monto ${money(info.amount)}`)
      if (info.currency) { setCurrency(info.currency); got.push(`moneda ${info.currency}`) }
    }
    if (info.reference && !concept.trim()) { setConcept(info.reference); got.push(`concepto "${info.reference}"`) }
    setInvoiceNote(
      got.length
        ? { ok: true, text: `Leído de la factura: ${got.join(', ')}. Revisa todo antes de guardar.` }
        : { ok: false, text: 'No encontré datos en esta factura (puede ser un escaneo o una foto). Llena el formulario a mano.' }
    )
  }

  const handleFile = async (f: File | null | undefined) => {
    if (!f) return
    if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) { setMessage({ ok: false, text: 'Solo se aceptan archivos PDF.' }); return }
    if (f.size > MAX_PDF_BYTES) { setMessage({ ok: false, text: 'El PDF pesa más de 4 MB. Comprímelo e inténtalo de nuevo.' }); return }
    setSupport(f)
    setMessage(null)
    setInvoiceNote(null)
    setReading(true)
    try {
      const text = await readPdfText(f)
      if (text.replace(/\s/g, '').length < 20) setInvoiceNote({ ok: false, text: 'Este PDF no tiene texto (parece un escaneo). Llena el formulario a mano.' })
      else applyInvoice(extractInvoiceInfo(text, known))
    } catch {
      setInvoiceNote({ ok: false, text: 'No pude leer el contenido del PDF. Llena el formulario a mano.' })
    }
    setReading(false)
  }

  const pickContractor = (v: string) => {
    setContractor(v)
    setContractCode('')
    setMessage(null)
    const last = recent.find((h) => h.contractor === v)
    if (last) {
      setDiscipline(last.discipline ?? '')
      setCurrency(last.currency ?? 'Dólares')
      if (isVt) { setCatN1(last.category_n1 ?? ''); setCatN2(last.category_n2 ?? '') }
      setPhone(last.phone ?? '')
      setEmail(last.email ?? '')
      setAccount(last.account ?? '')
    }
  }
  const pickContract = (v: string, who: string = contractor) => {
    setContractCode(v)
    const last = recent.find((c) => c.contractor === who && c.contract_code === v)
    if (last) {
      setDiscipline(last.discipline ?? '')
      setContractAmount(last.contract_amount !== null ? String(last.contract_amount) : '')
      setCurrency(last.currency ?? currency)
      setTaxType(last.tax_type && TAX_TYPES.includes(last.tax_type) ? last.tax_type : 'N/A')
      if (isVt) {
        setExtra(String(last.extra_amount ?? 0))
        setCatN1(last.category_n1 ?? '')
        setCatN2(last.category_n2 ?? '')
      }
    }
  }

  const calc = useMemo(
    () =>
      isVt
        ? (() => {
            const v = computeVtOrder(history, {
              contract_code: code,
              contract_amount: num(contractAmount),
              extra_amount: num(extra),
              amount_requested: num(amount),
              retentions: num(retentions),
            })
            return { ...v, tax_amount: 0, tax_accum: 0 }
          })()
        : { ...computeOrder(history, {
        contract_code: code,
        contract_amount: num(contractAmount),
        type,
        amount_requested: num(amount),
        advance_amort: num(advance),
        tax_type: taxType,
        retentions: num(retentions),
      }), quote_date: null as string | null },
    [history, code, contractAmount, type, amount, advance, taxType, retentions, isVt, extra]
  )

  const missing = !contractorName ? 'el contratista' : !code ? 'el contrato o presupuesto' : !concept.trim() ? 'el concepto' : !num(amount) ? 'el monto solicitado' : ''

  const [sendEmail, setSendEmail] = useState(true)
  const [syncExcel, setSyncExcel] = useState(true)
  const savingRef = useRef(false)
  const save = async () => {
    if (savingRef.current) return // a second tap while the first save is still running
    if (missing) { setMessage({ ok: false, text: `Falta ${missing}.` }); return }
    if (support && support.size > MAX_PDF_BYTES) { setMessage({ ok: false, text: 'El PDF pesa más de 4 MB. Comprímelo e inténtalo de nuevo.' }); return }
    savingRef.current = true
    setSaving(true)
    setMessage(null)
    const usd = currency === 'Dólares' ? num(amount) : num(rate) ? num(amount) / num(rate) : null
    const row: PaymentOrder = isVt ? {
      project,
      order_no: orderNo,
      order_date: today(),
      currency: isPgm ? currency : 'Dólares',
      contractor: contractorName,
      discipline: null,
      contract_code: code,
      contract_date: null,
      type: null,
      concept: concept.trim(),
      contract_amount: num(contractAmount),
      extra_amount: num(extra),
      amount_requested: num(amount),
      balance_before: calc.balance_before,
      advance_amort: null,
      tax_type: null,
      tax_amount: null,
      tax_accum: null,
      retentions: num(retentions),
      retentions_accum: calc.retentions_accum,
      net_to_pay: calc.net_to_pay,
      paid_after: calc.paid_after,
      remaining: calc.remaining,
      peticion: null,
      status: 'Solicitado',
      exchange_rate: null,
      amount_usd: isPgm ? Math.round(pgmUsd(calc.net_to_pay, currency) * 100) / 100 : num(amount),
      advance_date: calc.quote_date ?? today(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      account: account.trim() || null,
      comments: comments.trim() || null,
      pct_paid: calc.pct_paid,
      category_n1: catN1.trim() || null,
      category_n2: catN2.trim() || null,
    } : {
      project,
      order_no: orderNo,
      order_date: today(),
      currency,
      contractor: contractorName,
      discipline: discipline.trim() || null,
      contract_code: code,
      contract_date: contractDate || null,
      type,
      concept: concept.trim(),
      contract_amount: num(contractAmount),
      amount_requested: num(amount),
      balance_before: calc.balance_before,
      advance_amort: num(advance),
      tax_type: taxType,
      tax_amount: calc.tax_amount,
      tax_accum: calc.tax_accum,
      retentions: num(retentions),
      retentions_accum: calc.retentions_accum,
      net_to_pay: calc.net_to_pay,
      paid_after: calc.paid_after,
      remaining: calc.remaining,
      peticion: null,
      status: 'Solicitado',
      exchange_rate: currency === 'Dólares' ? null : num(rate) || null,
      amount_usd: usd,
      advance_date: null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      account: account.trim() || null,
      comments: comments.trim() || null,
      pct_paid: calc.pct_paid,
    }
    const { error } = await supabase.from('payment_orders').insert(row)
    if (error) {
      setSaving(false)
      savingRef.current = false
      setMessage({ ok: false, text: `No se pudo guardar: ${error.message}` })
      return
    }
    let text = `Orden ${orderNo} guardada.`
    let ok = true
    if (support) {
      try {
        const path = await uploadOrderPdf(support, project, orderNo, 'support')
        await supabase.from('payment_orders').update({ support_path: path }).eq('project', project).eq('order_no', orderNo)
        text += ' Soporte guardado en Dropbox.'
      } catch (e) {
        ok = false
        await supabase.from('payment_orders').update({ support_path: 'pending' }).eq('project', project).eq('order_no', orderNo)
        text += ` Pero el soporte no se pudo subir: ${e instanceof Error ? e.message : 'error'} Puedes subirlo después desde Historial.`
      }
    }
    try {
      const path = await saveOrderPdf(row)
      await supabase.from('payment_orders').update({ order_pdf_path: path }).eq('project', project).eq('order_no', orderNo)
      text += ' Orden en PDF guardada en Dropbox.'
    } catch (e) {
      ok = false
      await supabase.from('payment_orders').update({ order_pdf_path: 'pending' }).eq('project', project).eq('order_no', orderNo)
      text += ` Pero el PDF de la orden no se pudo guardar: ${e instanceof Error ? e.message : 'error'} Puedes regenerarlo desde Historial.`
    }
    if (sendEmail && ok) {
      try {
        const r = await sendOrderEmail(project, orderNo)
        await supabase.from('payment_orders').update({ emailed_at: new Date().toISOString() }).eq('project', project).eq('order_no', orderNo)
        text += ` Email enviado a ${r.to}.`
      } catch (e) {
        ok = false
        text += ` Pero el email no se envió: ${e instanceof Error ? e.message : 'error'} Puedes enviarlo desde Historial.`
      }
    } else if (sendEmail && !ok) {
      text += ' El email no se envió porque falta algún archivo; reenvíalo desde Historial cuando esté completo.'
    }
    if (syncExcel) {
      try {
        const r = await syncOrderToExcel(project, orderNo)
        if (r.mode === 'live') await supabase.from('payment_orders').update({ excel_synced_at: new Date().toISOString() }).eq('project', project).eq('order_no', orderNo)
        text += r.status === 'already' ? ' La orden ya estaba en el Excel.' : r.status === 'linked' ? ' Se agregó el enlace a su carpeta en el Excel.' : r.mode === 'live' ? ' Excel actualizado.' : ' Copia de prueba del Excel actualizada.'
      } catch (e) {
        ok = false
        text += ` Pero el Excel no se actualizó: ${e instanceof Error ? e.message : 'error'} Puedes sincronizarlo desde Historial.`
      }
    }
    setMessage({ ok, text })
    setConcept(''); setAmount(''); setAdvance('0'); setRetentions('0'); setComments(''); setSupport(null); setInvoiceNote(null)
    await onSaved()
    setSaving(false)
    savingRef.current = false
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
        className={`rounded-xl border-2 border-dashed p-4 text-center text-sm ${dragging ? 'border-emerald-600 bg-emerald-50' : 'border-gray-300 bg-gray-50'}`}
      >
        {support ? (
          <div className="space-y-1">
            <p className="font-medium text-gray-900 break-all">📄 {support.name}</p>
            {reading && <p className="text-gray-500">Leyendo la factura…</p>}
            <button type="button" onClick={() => { setSupport(null); setInvoiceNote(null) }} className="text-xs text-red-500">Quitar</button>
          </div>
        ) : (
          <label className="block cursor-pointer text-gray-600">
            <span className="font-medium text-gray-900">Arrastra aquí la factura (PDF)</span>
            <span className="block text-xs mt-0.5">o toca para elegirla. Se guardará en la carpeta de la orden en Dropbox y se intentará llenar el formulario con sus datos.</span>
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        )}
        {invoiceNote && <p className={`mt-2 text-xs ${invoiceNote.ok ? 'text-emerald-800' : 'text-amber-700'}`}>{invoiceNote.text}</p>}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">Orden de pago No.</span>
        <span className="text-lg font-bold text-gray-900">{orderNo}</span>
      </div>
      {excelAhead && <p className="text-xs text-amber-700 -mt-2">El Excel ya tiene órdenes hasta la {excelMax}; esta será la {orderNo}.</p>}

      <div>
        <label className={label}>Contratista</label>
        <InlinePicker
          value={contractor}
          placeholder="Selecciona el contratista"
          options={contractors.map((c) => ({ value: c, label: c }))}
          extra={{ value: '__new__', label: '+ Nuevo contratista…' }}
          onChange={pickContractor}
        />
        {isNewContractor && <input className={`${input} mt-2`} placeholder="Nombre del contratista" value={newContractor} onChange={(e) => setNewContractor(e.target.value)} />}
      </div>

      {contractorName && (
        <div>
          <label className={label}>Contrato / Presupuesto</label>
          <InlinePicker
            value={contractCode}
            placeholder="Selecciona el contrato"
            options={contracts.map((c) => ({ value: c.contract_code as string, label: `${c.contract_code}  ·  ${(isVt ? c.category_n2 : c.discipline) ?? ''}` }))}
            extra={{ value: '__new__', label: '+ Nuevo contrato o presupuesto…' }}
            onChange={pickContract}
          />
          {isNewContract && <input className={`${input} mt-2`} placeholder={isPgm ? 'Código (ej. SHS-01)' : isVt ? 'Código (ej. EV-03)' : 'Código (ej. CON-PLO-FER-03)'} value={newContract} onChange={(e) => setNewContract(e.target.value)} />}
        </div>
      )}

      {isVt && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Categoría contable (N1)</label>
            <input className={input} list="vt-cat1" value={catN1} onChange={(e) => setCatN1(e.target.value)} />
            <datalist id="vt-cat1">{[...new Set(history.map((h) => h.category_n1).filter(Boolean))].map((c) => <option key={c as string} value={c as string} />)}</datalist>
          </div>
          <div>
            <label className={label}>Categoría proforma (N2)</label>
            <input className={input} list="vt-cat2" value={catN2} onChange={(e) => setCatN2(e.target.value)} />
            <datalist id="vt-cat2">{[...new Set(history.filter((h) => !catN1 || h.category_n1 === catN1).map((h) => h.category_n2).filter(Boolean))].map((c) => <option key={c as string} value={c as string} />)}</datalist>
          </div>
        </div>
      )}

      {isPgm && (
        <div>
          <label className={label}>Moneda</label>
          <InlinePicker value={currency} placeholder="Moneda" options={CURRENCIES.map((t) => ({ value: t, label: t }))} onChange={setCurrency} />
        </div>
      )}

      {!isVt && <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Disciplina</label>
          <input className={input} value={discipline} onChange={(e) => setDiscipline(e.target.value)} />
        </div>
        <div>
          <label className={label}>Fecha presupuesto</label>
          <input type="date" className={input} value={contractDate} onChange={(e) => setContractDate(e.target.value)} />
        </div>
        <div>
          <label className={label}>Tipo</label>
          <InlinePicker value={type} placeholder="Tipo" options={PAYMENT_TYPES.map((t) => ({ value: t, label: t }))} onChange={setType} />
        </div>
        <div>
          <label className={label}>Moneda</label>
          <InlinePicker value={currency} placeholder="Moneda" options={CURRENCIES.map((t) => ({ value: t, label: t }))} onChange={setCurrency} />
        </div>
      </div>}

      <div>
        <label className={label}>Concepto del pago</label>
        <textarea className={input} rows={2} value={concept} onChange={(e) => setConcept(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Monto del contrato</label>
          <input inputMode="decimal" className={input} value={contractAmount} onChange={(e) => setContractAmount(e.target.value)} />
        </div>
        <div>
          <label className={label}>Monto solicitado</label>
          <input inputMode="decimal" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {isVt ? (
          <div>
            <label className={label}>Monto extra del contrato (órdenes de cambio, acumulado)</label>
            <input inputMode="decimal" className={input} value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
        ) : (
          <>
            <div>
              <label className={label}>Anticipo a amortizar</label>
              <input inputMode="decimal" className={input} value={advance} onChange={(e) => setAdvance(e.target.value)} />
            </div>
            <div>
              <label className={label}>IVA o VAT</label>
              <InlinePicker value={taxType} placeholder="Impuesto" options={TAX_TYPES.map((t) => ({ value: t, label: t === 'IVA' ? 'IVA (12%)' : t === 'VAT' ? 'VAT (6%)' : 'N/A' }))} onChange={setTaxType} />
            </div>
          </>
        )}
        <div>
          <label className={label}>Retenciones</label>
          <input inputMode="decimal" className={input} value={retentions} onChange={(e) => setRetentions(e.target.value)} />
        </div>
        {!isVt && currency !== 'Dólares' && (
          <div>
            <label className={label}>Valor dólar ({currency} por 1 USD)</label>
            <input inputMode="decimal" className={input} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="ej. 1.79" />
          </div>
        )}
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm space-y-1">
        <Row k="Saldo antes de pago" v={money(calc.balance_before)} />
        {!isVt && <Row k="IVA / VAT" v={money(calc.tax_amount)} />}
        <Row k="Monto neto a pagar" v={money(calc.net_to_pay)} strong />
        <Row k="Total pagado después de este pago" v={money(calc.paid_after)} />
        <Row k={isVt ? 'Restante del contrato (con extras)' : 'Restante del contrato (sin IVA)'} v={money(calc.remaining)} />
        <Row k="% del contrato pagado" v={`${(calc.pct_paid * 100).toFixed(1)}%`} />
      </div>

      <div>
        <label className={label}>Cuenta / forma de depósito</label>
        <textarea className={input} rows={3} value={account} onChange={(e) => setAccount(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Teléfono</label>
          <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className={label}>Email beneficiario</label>
          <input className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={label}>Comentarios adicionales (van en el cuerpo del email a Ana)</label>
        <textarea className={input} rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />
      </div>

      {message && <p className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
        Enviar el email al guardar
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={syncExcel} onChange={(e) => setSyncExcel(e.target.checked)} />
        Agregar la orden al Excel en Dropbox
      </label>
      <button onClick={save} disabled={saving} className="w-full py-3 rounded-lg bg-gray-900 text-white font-medium disabled:opacity-40">
        {saving ? 'Guardando…' : 'Guardar orden'}
      </button>
      <p className="text-xs text-gray-600">
        Destinatario del email: {recipient === undefined ? '…' : recipient ? <b>{recipient.name} ({recipient.email})</b> : <b className="text-red-600">ninguno activo</b>}. Se cambia en Listas.
      </p>
      <p className="text-xs text-gray-400">
        La orden, su PDF y el soporte se guardan en la app y en Dropbox, y se envían por email al destinatario activo.
      </p>
    </div>
  )
}

// Builds the order PDF in the template format and files it in the order's Dropbox folder.
async function saveOrderPdf(o: PaymentOrder): Promise<string> {
  const { buildOrderPdf } = await import('../lib/orderPdf')
  const bytes = await buildOrderPdf(o)
  const file = new File([bytes as BlobPart], `${o.project} Orden de Pago ${o.order_no}.pdf`, { type: 'application/pdf' })
  return uploadOrderPdf(file, o.project, o.order_no, 'order')
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-600">{k}</span>
      <span className={strong ? 'font-bold text-gray-900' : 'text-gray-900'}>{v}</span>
    </div>
  )
}

function History({ history, project, onChanged }: { history: PaymentOrder[]; project: string; onChanged: () => Promise<void> }) {
  const [q, setQ] = useState('')
  const [note, setNote] = useState('')
  const { confirm } = useFeedback()
  const remove = async (h: PaymentOrder) => {
    const files: ('support' | 'order')[] = []
    if (h.support_path && h.support_path !== 'pending') files.push('support')
    if (h.order_pdf_path && h.order_pdf_path !== 'pending') files.push('order')
    const dropboxLine = files.length
      ? 'También se borrarán sus archivos de Dropbox (quedan en "Archivos eliminados" de Dropbox por un tiempo).'
      : 'No tiene archivos guardados por la app, así que no se borran archivos de Dropbox.'
    const ok = await confirm(
      `¿Borrar la orden ${h.order_no} (${h.contractor ?? ''}, ${money(h.net_to_pay)} ${h.currency ?? ''})? Dejará de contar en los saldos y acumulados de su contrato. ${dropboxLine} También se quitará su línea del Excel (y la pestaña, en Harbour House); Dropbox guarda versiones anteriores del archivo por si necesitas recuperarla.`,
      { danger: true, confirmLabel: 'Borrar' }
    )
    if (!ok || !h.id) return
    setNote('Borrando…')
    try {
      // Take the order out of the Excel first; if that fails, ask before going on.
      try {
        await syncOrderToExcel(project, h.order_no, 'remove')
      } catch (e) {
        const go = await confirm(`No se pudo quitar la orden del Excel: ${e instanceof Error ? e.message : 'error'} ¿Borrarla de la app de todas formas? Tendrías que quitarla del Excel a mano.`, { danger: true, confirmLabel: 'Borrar igual' })
        if (!go) { setNote(''); return }
      }
      if (files.length) await deleteOrderFiles(project, h.order_no, files)
      const { error } = await supabase.from('payment_orders').delete().eq('id', h.id)
      if (error) throw new Error(error.message)
      setNote(`Orden ${h.order_no} borrada.`)
      await onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'No se pudo borrar.')
    }
  }
  const retry = async (orderNo: string, file: File | undefined) => {
    if (!file) return
    setNote('Subiendo…')
    try {
      const path = await uploadOrderPdf(file, project, orderNo, 'support')
      await supabase.from('payment_orders').update({ support_path: path }).eq('project', project).eq('order_no', orderNo)
      setNote(`Soporte de la orden ${orderNo} guardado en Dropbox.`)
      await onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'No se pudo subir.')
    }
  }
  const view = async (h: PaymentOrder) => {
    setNote('Generando PDF…')
    try {
      const { buildOrderPdf } = await import('../lib/orderPdf')
      const bytes = await buildOrderPdf(h)
      window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), '_blank')
      setNote('')
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'No se pudo generar el PDF.')
    }
  }
  const toExcel = async (h: PaymentOrder) => {
    setNote('Actualizando el Excel…')
    try {
      const r = await syncOrderToExcel(project, h.order_no)
      if (r.mode === 'live') await supabase.from('payment_orders').update({ excel_synced_at: new Date().toISOString() }).eq('id', h.id)
      setNote(r.status === 'already' ? `La orden ${h.order_no} ya estaba en el Excel.` : r.status === 'linked' ? `Se agregó el enlace a la carpeta de la orden ${h.order_no} en el Excel.` : r.mode === 'live' ? `Orden ${h.order_no} agregada al Excel.` : `Orden ${h.order_no} agregada a la copia de prueba del Excel.`)
      await onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'No se pudo actualizar el Excel.')
    }
  }
  const email = async (h: PaymentOrder) => {
    const ok = await confirm(`¿Enviar por email la orden ${h.order_no} con sus PDFs al destinatario activo?${h.emailed_at ? ' Ya fue enviada antes.' : ''}`, { confirmLabel: 'Enviar' })
    if (!ok) return
    setNote('Enviando email…')
    try {
      const r = await sendOrderEmail(project, h.order_no)
      await supabase.from('payment_orders').update({ emailed_at: new Date().toISOString() }).eq('id', h.id)
      setNote(`Email de la orden ${h.order_no} enviado a ${r.to}.`)
      await onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'No se pudo enviar.')
    }
  }
  const regenerate = async (h: PaymentOrder) => {
    setNote('Guardando PDF de la orden…')
    try {
      const path = await saveOrderPdf(h)
      await supabase.from('payment_orders').update({ order_pdf_path: path }).eq('id', h.id)
      setNote(`PDF de la orden ${h.order_no} guardado en Dropbox.`)
      await onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'No se pudo guardar.')
    }
  }
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const rows = useMemo(() => {
    const all = [...history].reverse()
    const query = norm(q.trim())
    const filtered = query
      ? all.filter((h) => norm(`${h.order_no} ${h.contractor ?? ''} ${h.contract_code ?? ''} ${h.concept ?? ''}`).includes(query))
      : all
    return filtered.slice(0, 60)
  }, [history, q])

  return (
    <div className="space-y-2">
      <input className={input} placeholder={`Buscar entre ${history.length} órdenes…`} value={q} onChange={(e) => setQ(e.target.value)} />
      {note && <p className="text-sm text-gray-700">{note}</p>}
      {rows.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Sin resultados</p>}
      {rows.map((h) => (
        <div key={h.order_no} className="border border-gray-200 rounded-lg p-3 text-sm">
          <div className="flex justify-between gap-2">
            <span className="font-bold text-gray-900">#{h.order_no} · {h.contractor}</span>
            <span className="text-gray-500 shrink-0">{h.order_date ?? ''}</span>
          </div>
          <button onClick={() => remove(h)} className="float-right text-xs text-red-500 ml-2">Borrar</button>
          {h.order_pdf_path && h.order_pdf_path !== 'pending' && (
            <button onClick={() => email(h)} className="float-right text-xs text-emerald-700 ml-2">{h.emailed_at ? 'Reenviar email' : 'Enviar email'}</button>
          )}
          {h.order_pdf_path && (
            <button onClick={() => toExcel(h)} className="float-right text-xs text-gray-600 ml-2">{h.excel_synced_at ? 'Excel ✓' : 'Agregar al Excel'}</button>
          )}
          <button onClick={() => view(h)} className="float-right text-xs text-blue-600 ml-2">Ver PDF</button>
          <div className="text-gray-600">{h.contract_code} · {h.type ?? h.category_n2 ?? ''}</div>
          <div className="text-gray-800 mt-0.5">{h.concept}</div>
          <div className="text-gray-900 font-medium mt-1">{money(h.net_to_pay)} {h.currency}</div>
          {h.order_pdf_path === 'pending' && (
            <button onClick={() => regenerate(h)} className="block mt-2 text-xs text-amber-700 underline">
              Falta el PDF de la orden en Dropbox: regenerar y guardar
            </button>
          )}
          {h.support_path === 'pending' && (
            <label className="block mt-2 text-xs text-amber-700">
              Falta subir el soporte a Dropbox:{' '}
              <input type="file" accept="application/pdf,.pdf" onChange={(e) => retry(h.order_no, e.target.files?.[0])} />
            </label>
          )}
        </div>
      ))}
    </div>
  )
}

function ImportExcel({ project, existing, onDone }: { project: string; existing: number; onDone: () => Promise<void> }) {
  const [rows, setRows] = useState<PaymentOrder[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setMsg(null); setRows(null); setBusy(true)
    try {
      setRows(parsePagosWorkbook(await f.arrayBuffer(), project))
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo leer el archivo.' })
    }
    setBusy(false)
  }

  const run = async () => {
    if (!rows) return
    setBusy(true); setMsg(null)
    const { data: u } = await supabase.auth.getUser()
    const uid = u.user?.id
    if (!uid) { setBusy(false); setMsg({ ok: false, text: 'Sesión expirada. Vuelve a entrar.' }); return }
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, owner_id: uid }))
      const { error } = await supabase.from('payment_orders').upsert(chunk, { onConflict: 'owner_id,project,order_no' })
      if (error) { setBusy(false); setMsg({ ok: false, text: `Falló en el bloque ${i / 200 + 1}: ${error.message}` }); return }
    }
    setBusy(false)
    setMsg({ ok: true, text: `Listo: ${rows.length} órdenes importadas.` })
    setRows(null)
    await onDone()
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-600">
        Elige tu archivo de pagos (.xlsm). Se lee en tu navegador, solo se toma la hoja {isVtLike(project) ? 'Pagos' : 'PagosBH'} y se guardan las órdenes en tu base de datos.
        Si vuelves a importar, las órdenes con el mismo número se actualizan, no se duplican.
      </p>
      <p className="text-gray-500">Órdenes guardadas actualmente para este proyecto: <b>{existing}</b></p>
      <input type="file" accept=".xlsm,.xlsx" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
      {rows && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
          <p>Encontré <b>{rows.length}</b> órdenes. Última: <b>#{rows[rows.length - 1]?.order_no}</b> ({rows[rows.length - 1]?.contractor}).</p>
          <button onClick={run} disabled={busy} className="px-4 py-2 rounded-lg bg-gray-900 text-white disabled:opacity-40">
            {busy ? 'Importando…' : `Importar ${rows.length} órdenes`}
          </button>
        </div>
      )}
      {busy && !rows && <p className="text-gray-500">Leyendo archivo…</p>}
      {msg && <p className={msg.ok ? 'text-green-700' : 'text-red-600'}>{msg.text}</p>}
    </div>
  )
}

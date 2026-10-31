import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import InlinePicker from './InlinePicker'
import { loadActiveRecipient, type PaymentRecipient } from './PaymentRecipients'
import {
  CURRENCIES, PAYMENT_TYPES, PROJECTS, TAX_TYPES, computeOrder, nextOrderNumber, parsePagosWorkbook,
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
          {history !== null && tab === 'new' && <NewOrder project={project} history={history} onSaved={reload} />}
          {history !== null && tab === 'history' && <History history={history} />}
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
  const [rate, setRate] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [account, setAccount] = useState('')
  const [comments, setComments] = useState('')
  const [saving, setSaving] = useState(false)
  const [recipient, setRecipient] = useState<PaymentRecipient | null | undefined>(undefined)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    loadActiveRecipient().then(setRecipient)
  }, [])

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

  const orderNo = nextOrderNumber(history)

  const pickContractor = (v: string) => {
    setContractor(v)
    setContractCode('')
    setMessage(null)
    const last = recent.find((h) => h.contractor === v)
    if (last) {
      setDiscipline(last.discipline ?? '')
      setCurrency(last.currency ?? 'Dólares')
      setPhone(last.phone ?? '')
      setEmail(last.email ?? '')
      setAccount(last.account ?? '')
    }
  }
  const pickContract = (v: string) => {
    setContractCode(v)
    const last = contracts.find((c) => c.contract_code === v)
    if (last) {
      setDiscipline(last.discipline ?? '')
      setContractAmount(last.contract_amount !== null ? String(last.contract_amount) : '')
      setCurrency(last.currency ?? currency)
      setTaxType(last.tax_type && TAX_TYPES.includes(last.tax_type) ? last.tax_type : 'N/A')
    }
  }

  const calc = useMemo(
    () =>
      computeOrder(history, {
        contract_code: code,
        contract_amount: num(contractAmount),
        type,
        amount_requested: num(amount),
        advance_amort: num(advance),
        tax_type: taxType,
        retentions: num(retentions),
      }),
    [history, code, contractAmount, type, amount, advance, taxType, retentions]
  )

  const missing = !contractorName ? 'el contratista' : !code ? 'el contrato o presupuesto' : !concept.trim() ? 'el concepto' : !num(amount) ? 'el monto solicitado' : ''

  const save = async () => {
    if (missing) { setMessage({ ok: false, text: `Falta ${missing}.` }); return }
    setSaving(true)
    setMessage(null)
    const usd = currency === 'Dólares' ? num(amount) : num(rate) ? num(amount) / num(rate) : null
    const row: PaymentOrder = {
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
    setSaving(false)
    if (error) {
      setMessage({ ok: false, text: `No se pudo guardar: ${error.message}` })
      return
    }
    setMessage({ ok: true, text: `Orden ${orderNo} guardada.` })
    setConcept(''); setAmount(''); setAdvance('0'); setRetentions('0'); setComments('')
    await onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">Orden de pago No.</span>
        <span className="text-lg font-bold text-gray-900">{orderNo}</span>
      </div>

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
            options={contracts.map((c) => ({ value: c.contract_code as string, label: `${c.contract_code}  ·  ${c.discipline ?? ''}` }))}
            extra={{ value: '__new__', label: '+ Nuevo contrato o presupuesto…' }}
            onChange={pickContract}
          />
          {isNewContract && <input className={`${input} mt-2`} placeholder="Código (ej. CON-PLO-FER-03)" value={newContract} onChange={(e) => setNewContract(e.target.value)} />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
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
      </div>

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
        <div>
          <label className={label}>Anticipo a amortizar</label>
          <input inputMode="decimal" className={input} value={advance} onChange={(e) => setAdvance(e.target.value)} />
        </div>
        <div>
          <label className={label}>IVA o VAT</label>
          <InlinePicker value={taxType} placeholder="Impuesto" options={TAX_TYPES.map((t) => ({ value: t, label: t === 'IVA' ? 'IVA (12%)' : t === 'VAT' ? 'VAT (6%)' : 'N/A' }))} onChange={setTaxType} />
        </div>
        <div>
          <label className={label}>Retenciones</label>
          <input inputMode="decimal" className={input} value={retentions} onChange={(e) => setRetentions(e.target.value)} />
        </div>
        {currency !== 'Dólares' && (
          <div>
            <label className={label}>Valor dólar ({currency} por 1 USD)</label>
            <input inputMode="decimal" className={input} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="ej. 1.79" />
          </div>
        )}
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm space-y-1">
        <Row k="Saldo antes de pago" v={money(calc.balance_before)} />
        <Row k="IVA / VAT" v={money(calc.tax_amount)} />
        <Row k="Monto neto a pagar" v={money(calc.net_to_pay)} strong />
        <Row k="Total pagado después de este pago" v={money(calc.paid_after)} />
        <Row k="Restante del contrato (sin IVA)" v={money(calc.remaining)} />
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
      <button onClick={save} disabled={saving} className="w-full py-3 rounded-lg bg-gray-900 text-white font-medium disabled:opacity-40">
        {saving ? 'Guardando…' : 'Guardar orden'}
      </button>
      <p className="text-xs text-gray-600">
        Destinatario del email: {recipient === undefined ? '…' : recipient ? <b>{recipient.name} ({recipient.email})</b> : <b className="text-red-600">ninguno activo</b>}. Se cambia en Listas.
      </p>
      <p className="text-xs text-gray-400">
        Por ahora la orden se guarda en la app. El PDF, la factura en Dropbox y el email a Ana se conectan en la siguiente etapa.
      </p>
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-600">{k}</span>
      <span className={strong ? 'font-bold text-gray-900' : 'text-gray-900'}>{v}</span>
    </div>
  )
}

function History({ history }: { history: PaymentOrder[] }) {
  const [q, setQ] = useState('')
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
      {rows.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Sin resultados</p>}
      {rows.map((h) => (
        <div key={h.order_no} className="border border-gray-200 rounded-lg p-3 text-sm">
          <div className="flex justify-between gap-2">
            <span className="font-bold text-gray-900">#{h.order_no} · {h.contractor}</span>
            <span className="text-gray-500 shrink-0">{h.order_date ?? ''}</span>
          </div>
          <div className="text-gray-600">{h.contract_code} · {h.type}</div>
          <div className="text-gray-800 mt-0.5">{h.concept}</div>
          <div className="text-gray-900 font-medium mt-1">{money(h.net_to_pay)} {h.currency}</div>
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
        Elige tu archivo Pagos_Harbour_House.xlsm. Se lee en tu navegador, solo se toma la hoja PagosBH y se guardan las órdenes en tu base de datos.
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

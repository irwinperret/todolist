import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFeedback } from '../lib/FeedbackContext'

export type PaymentRecipient = { id: string; name: string; email: string; is_active: boolean; cc_vt?: boolean }

export async function loadActiveRecipient(): Promise<PaymentRecipient | null> {
  const { data } = await supabase.from('payment_recipients').select('*').eq('is_active', true).limit(1)
  return ((data as PaymentRecipient[]) ?? [])[0] ?? null
}

// "Destinatarios de órdenes de pago": who receives the payment order email.
// Exactly one is active at a time; that one is used when an order is sent.
export default function PaymentRecipients() {
  const { notifyError, confirm } = useFeedback()
  const [list, setList] = useState<PaymentRecipient[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('payment_recipients').select('*').order('created_at')
    if (error) notifyError(error.message)
    else setList((data as PaymentRecipient[]) ?? [])
  }, [notifyError])

  useEffect(() => {
    reload()
  }, [reload])

  const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

  const add = async () => {
    if (!name.trim() || !validEmail(email)) return notifyError('Escribe un nombre y un email válido.')
    const { error } = await supabase.from('payment_recipients').insert({ name: name.trim(), email: email.trim(), is_active: list.length === 0 })
    if (error) return notifyError(error.message)
    setName(''); setEmail('')
    reload()
  }

  const activate = async (id: string) => {
    const off = await supabase.from('payment_recipients').update({ is_active: false }).neq('id', id)
    if (off.error) return notifyError(off.error.message)
    const on = await supabase.from('payment_recipients').update({ is_active: true }).eq('id', id)
    if (on.error) return notifyError(on.error.message)
    reload()
  }

  const toggleCc = async (r: PaymentRecipient) => {
    const { error } = await supabase.from('payment_recipients').update({ cc_vt: !r.cc_vt }).eq('id', r.id)
    if (error) return notifyError(error.message)
    reload()
  }

  const saveEdit = async () => {
    if (!editId || !editName.trim() || !validEmail(editEmail)) return notifyError('Escribe un nombre y un email válido.')
    const { error } = await supabase.from('payment_recipients').update({ name: editName.trim(), email: editEmail.trim() }).eq('id', editId)
    if (error) return notifyError(error.message)
    setEditId(null)
    reload()
  }

  const remove = async (r: PaymentRecipient) => {
    if (r.is_active) return notifyError('Primero activa otro destinatario y luego borra este.')
    if (!(await confirm(`¿Borrar a "${r.name}"?`, { danger: true, confirmLabel: 'Borrar' }))) return
    const { error } = await supabase.from('payment_recipients').delete().eq('id', r.id)
    if (error) notifyError(error.message)
    else reload()
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      <p className="text-xs text-gray-500">
        La orden de pago se envía al destinatario marcado como activo. Toca el círculo para cambiarlo. Las personas marcadas con "Copia WRJ" reciben copia solo de las órdenes de Vermont (WRJ); desmárcalo para dejar de copiarlas.
      </p>
      <div className="space-y-1">
        {list.map((r) => (
          <div key={r.id} className="py-2 border-b border-gray-100">
            {editId === r.id ? (
              <div className="space-y-2">
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nombre" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" autoFocus />
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" onKeyDown={(e) => e.key === 'Enter' && saveEdit()} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                <div className="flex gap-3">
                  <button onClick={saveEdit} className="text-xs text-green-600 font-medium">Guardar</button>
                  <button onClick={() => setEditId(null)} className="text-xs text-gray-400">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => activate(r.id)} className="flex items-center gap-2 min-w-0 text-left" aria-label={`Usar a ${r.name} como destinatario`}>
                  <span className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${r.is_active ? 'border-emerald-600' : 'border-gray-300'}`}>
                    {r.is_active && <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{r.name}{r.is_active && <span className="text-emerald-700 text-xs ml-2">activo</span>}</span>
                    <span className="block text-xs text-gray-400 truncate">{r.email}</span>
                  </span>
                </button>
                <div className="flex gap-2 shrink-0">
                  {!r.is_active && (
                    <button onClick={() => toggleCc(r)} className={`text-xs ${r.cc_vt ? 'text-emerald-700 font-medium' : 'text-gray-400'}`}>
                      {r.cc_vt ? '✓ Copia WRJ' : 'Copia WRJ'}
                    </button>
                  )}
                  <button onClick={() => { setEditId(r.id); setEditName(r.name); setEditEmail(r.email) }} className="text-xs text-blue-600">Editar</button>
                  <button onClick={() => remove(r)} className="text-xs text-red-500">Borrar</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2 border border-gray-100 rounded-lg p-3 bg-gray-50">
        <p className="text-xs text-gray-500">Nuevo destinatario</p>
        <input type="text" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <button onClick={add} className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm">Agregar destinatario</button>
      </div>
    </div>
  )
}

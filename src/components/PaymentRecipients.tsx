import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFeedback } from '../lib/FeedbackContext'
import { PROJECTS } from '../lib/payments'

export type PaymentRecipient = { id: string; name: string; email: string; is_active: boolean; is_cc?: boolean; project: string }

export async function loadActiveRecipient(project: string): Promise<PaymentRecipient | null> {
  const { data } = await supabase.from('payment_recipients').select('*').eq('project', project).eq('is_active', true).limit(1)
  return ((data as PaymentRecipient[]) ?? [])[0] ?? null
}

// "Destinatarios de órdenes de pago", one list per project. In each project exactly
// one person is active (receives the order email) and others can be marked "copia"
// to receive a copy.
export default function PaymentRecipients() {
  const { notifyError, confirm } = useFeedback()
  const [list, setList] = useState<PaymentRecipient[]>([])
  const [project, setProject] = useState(PROJECTS[0].value)
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
  const mine = list.filter((r) => r.project === project)

  const add = async () => {
    if (!name.trim() || !validEmail(email)) return notifyError('Escribe un nombre y un email válido.')
    const { error } = await supabase.from('payment_recipients').insert({ name: name.trim(), email: email.trim(), is_active: mine.length === 0, project })
    if (error) return notifyError(error.message)
    setName(''); setEmail('')
    reload()
  }

  const activate = async (r: PaymentRecipient) => {
    const off = await supabase.from('payment_recipients').update({ is_active: false }).eq('project', r.project).neq('id', r.id)
    if (off.error) return notifyError(off.error.message)
    const on = await supabase.from('payment_recipients').update({ is_active: true, is_cc: false }).eq('id', r.id)
    if (on.error) return notifyError(on.error.message)
    reload()
  }

  const toggleCc = async (r: PaymentRecipient) => {
    const { error } = await supabase.from('payment_recipients').update({ is_cc: !r.is_cc }).eq('id', r.id)
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
      <div className="flex gap-2 text-sm">
        {PROJECTS.map((p) => (
          <button
            key={p.value}
            onClick={() => { setProject(p.value); setEditId(null) }}
            className={`px-3 py-1.5 rounded-full border ${project === p.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        Cada proyecto tiene su propia lista. La orden de pago se envía a quien esté activo (toca el círculo para cambiarlo). Quien tenga "Copia" marcado recibe una copia de las órdenes de este proyecto; tócalo de nuevo para quitarla.
      </p>
      <div className="space-y-1">
        {mine.length === 0 && <p className="text-sm text-gray-400 py-2">Sin destinatarios en este proyecto.</p>}
        {mine.map((r) => (
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
                <button onClick={() => activate(r)} className="flex items-center gap-2 min-w-0 text-left" aria-label={`Usar a ${r.name} como destinatario`}>
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
                    <button onClick={() => toggleCc(r)} className={`text-xs ${r.is_cc ? 'text-emerald-700 font-medium' : 'text-gray-400'}`}>
                      {r.is_cc ? '✓ Copia' : 'Copia'}
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
        <p className="text-xs text-gray-500">Nuevo destinatario para {PROJECTS.find((p) => p.value === project)?.label}</p>
        <input type="text" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <button onClick={add} className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm">Agregar destinatario</button>
      </div>
    </div>
  )
}

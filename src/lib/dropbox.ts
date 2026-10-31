import { supabase } from './supabase'

export const MAX_PDF_BYTES = 4_400_000

// Sends a PDF to the server, which files it in the order's Dropbox folder.
export async function uploadOrderPdf(file: File, project: string, orderNo: string, kind: 'support' | 'order'): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sesión expirada. Vuelve a entrar.')
  const res = await fetch(`/api/dropbox-upload?project=${encodeURIComponent(project)}&order=${encodeURIComponent(orderNo)}&kind=${kind}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  if (res.ok) return ((await res.json()) as { path: string }).path
  const err = ((await res.json().catch(() => ({}))) as { error?: string }).error
  if (res.status === 503) throw new Error('Dropbox todavía no está configurado en Vercel.')
  if (err === 'not_pdf') throw new Error('El archivo no es un PDF válido.')
  if (err === 'too_large') throw new Error('El PDF pesa más de 4 MB. Comprímelo e inténtalo de nuevo.')
  throw new Error(`No se pudo subir a Dropbox (${res.status}).`)
}

// Removes the support and/or order PDF this app saved for an order from Dropbox.
export async function deleteOrderFiles(project: string, orderNo: string, files: ('support' | 'order')[]): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sesión expirada. Vuelve a entrar.')
  const res = await fetch(`/api/dropbox-delete?project=${encodeURIComponent(project)}&order=${encodeURIComponent(orderNo)}&files=${files.join(',')}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.ok) return
  if (res.status === 503) throw new Error('Dropbox todavía no está configurado en Vercel.')
  throw new Error(`No se pudieron borrar los archivos de Dropbox (${res.status}).`)
}

// Asks the server to email the order PDF and its support to the active recipient.
export async function sendOrderEmail(project: string, orderNo: string): Promise<{ to: string; attachments: number }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sesión expirada. Vuelve a entrar.')
  const res = await fetch(`/api/send-order-email?project=${encodeURIComponent(project)}&order=${encodeURIComponent(orderNo)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => ({}))) as { to?: string; attachments?: number; error?: string; detail?: string }
  if (res.ok) return { to: body.to ?? '', attachments: body.attachments ?? 0 }
  if (body.error === 'not_configured') throw new Error('El correo todavía no está configurado en Vercel (SMTP_USER y SMTP_PASS).')
  if (body.error === 'no_recipient') throw new Error('No hay destinatario activo en Listas.')
  if (body.error === 'order_pdf_missing') throw new Error('Falta el PDF de la orden en Dropbox.')
  if (body.error === 'send_failed') throw new Error(`El correo rechazó el envío${body.detail ? `: ${body.detail}` : ''}`)
  throw new Error(`No se pudo enviar el email (${res.status}).`)
}

export type ExcelSyncResult = { mode: 'live' | 'test'; status: 'added' | 'already' | 'removed' | 'absent'; row: number | null; tab?: string }

// Adds the order to the Excel workbook in Dropbox (a test copy until live mode is on).
export async function syncOrderToExcel(project: string, orderNo: string, action: 'add' | 'remove' = 'add'): Promise<ExcelSyncResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sesión expirada. Vuelve a entrar.')
  const res = await fetch(`/api/excel-sync?project=${encodeURIComponent(project)}&order=${encodeURIComponent(orderNo)}${action === 'remove' ? '&action=remove' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => ({}))) as Partial<ExcelSyncResult> & { error?: string }
  if (res.ok) return body as ExcelSyncResult
  if (body.error === 'not_configured') throw new Error('Dropbox todavía no está configurado en Vercel.')
  if (body.error === 'excel_not_found') throw new Error('No encontré el Excel en Dropbox.')
  if (body.error === 'excel_unreadable') throw new Error('No pude leer el Excel para agregar la orden.')
  if (body.error === 'conflict') throw new Error('El Excel cambió mientras tanto (¿lo tienes abierto?). Ciérralo y reintenta desde Historial.')
  throw new Error(`No se pudo actualizar el Excel (${res.status}).`)
}

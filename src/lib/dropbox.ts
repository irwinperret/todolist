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

// Emails a payment order (the order PDF and the supplier's support PDF, both read
// from the order's Dropbox folder) to the active recipient chosen in Listas.
// The mail account lives only in Vercel env vars: SMTP_USER, SMTP_PASS (an app
// password) and optionally SMTP_HOST / SMTP_PORT (default Outlook.com, port 587).
// The recipient and the order data are read from Supabase with the caller's own
// session, so the browser cannot make this send to an arbitrary address.
import nodemailer from 'nodemailer'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })

const ROOT = process.env.DROPBOX_PAGOS_ROOT || '/pering/ijp/mar azul - todo/mar azul. personal/obra/1. Pagos'
const PROJECT_FOLDER: Record<string, string> = { HH: 'Pagos BH' }

const headerJson = (o: unknown) =>
  JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

async function rest<T>(request: Request, query: string): Promise<T | null> {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const auth = request.headers.get('authorization')
  if (!url || !anon || !auth) return null
  const res = await fetch(`${url}/rest/v1/${query}`, { headers: { apikey: anon, Authorization: auth } })
  return res.ok ? ((await res.json()) as T) : null
}

async function signedIn(request: Request): Promise<boolean> {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const auth = request.headers.get('authorization')
  if (!url || !anon || !auth) return false
  return (await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } })).ok
}

async function dropboxToken(): Promise<string | null> {
  const key = process.env.DROPBOX_APP_KEY
  const secret = process.env.DROPBOX_APP_SECRET
  const refresh = process.env.DROPBOX_REFRESH_TOKEN
  if (!key || !secret || !refresh) return null
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  })
  return res.ok ? ((await res.json()) as { access_token?: string }).access_token ?? null : null
}

async function download(token: string, path: string): Promise<Buffer | null> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': headerJson({ path }) },
  })
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(request: Request) {
  if (!(await signedIn(request))) return json({ error: 'unauthorized' }, 401)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) return json({ error: 'not_configured' }, 503)

  const params = new URL(request.url).searchParams
  const project = params.get('project') ?? ''
  const order = params.get('order') ?? ''
  const folder = PROJECT_FOLDER[project]
  if (!folder || !/^[0-9A-Za-z-]{1,20}$/.test(order)) return json({ error: 'bad request' }, 400)

  const recips = await rest<{ name: string; email: string }[]>(request, 'payment_recipients?is_active=eq.true&select=name,email&limit=1')
  const to = recips?.[0]
  if (!to) return json({ error: 'no_recipient' }, 409)
  const orders = await rest<{ comments: string | null }[]>(
    request, `payment_orders?project=eq.${encodeURIComponent(project)}&order_no=eq.${encodeURIComponent(order)}&select=comments&limit=1`)
  const comments = orders?.[0]?.comments?.trim() ?? ''

  const token = await dropboxToken()
  if (!token) return json({ error: 'dropbox_not_configured' }, 503)
  const dir = `${ROOT}/${folder}/${order}`
  const orderPdf = await download(token, `${dir}/${project} Orden de Pago ${order}.pdf`)
  const support = await download(token, `${dir}/Soporte Orden ${order}.pdf`)
  if (!orderPdf) return json({ error: 'order_pdf_missing' }, 409)

  const attachments = [{ filename: `${project} Orden de Pago ${order}.pdf`, content: orderPdf }]
  if (support) attachments.push({ filename: `Soporte Orden ${order}.pdf`, content: support })

  const first = to.name.trim().split(/\s+/)[0] || ''
  const lines = [`Buenas tardes ${first},`.replace(' ,', ','), '', 'Por favor, ayúdame a tramitar el siguiente pago.']
  if (comments) lines.push('', comments)
  lines.push('', 'Saludos,', 'Irwin Perret', 'Gerente de Operaciones')
  const text = lines.join('\n')

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-mail.outlook.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    requireTLS: true,
    auth: { user, pass },
  })
  try {
    await transport.sendMail({
      from: `Irwin Perret <${user}>`,
      to: `${to.name} <${to.email}>`,
      subject: `Orden de Pago ${order}`,
      text,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px">${esc(text).replace(/\n/g, '<br>')}</div>`,
      attachments,
    })
  } catch (e) {
    console.error('smtp error', e instanceof Error ? e.message : e)
    return json({ error: 'send_failed', detail: e instanceof Error ? e.message.slice(0, 200) : 'error' }, 502)
  }
  return json({ sent: true, to: to.email, attachments: attachments.length })
}

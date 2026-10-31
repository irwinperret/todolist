// Uploads a payment-order PDF (the supplier's invoice, or later the generated
// order) into the order's folder in Dropbox. The Dropbox credentials live only in
// Vercel env vars (DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN) and
// never reach the browser. Requires a valid Supabase session.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })

async function isSignedIn(request: Request): Promise<boolean> {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const auth = request.headers.get('authorization')
  if (!url || !anon || !auth) return false
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } })
  return res.ok
}

const ROOT = process.env.DROPBOX_PAGOS_ROOT || '/pering/ijp/mar azul - todo/mar azul. personal/obra/1. Pagos'
const PROJECT_FOLDER: Record<string, string> = { HH: 'Pagos BH' }
const MAX_BYTES = 4_400_000 // Vercel functions accept request bodies up to 4.5 MB

// Dropbox-API-Arg is an HTTP header, so anything non-ASCII must be \u-escaped.
const headerJson = (o: unknown) =>
  JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

async function accessToken(): Promise<string | null> {
  const key = process.env.DROPBOX_APP_KEY
  const secret = process.env.DROPBOX_APP_SECRET
  const refresh = process.env.DROPBOX_REFRESH_TOKEN
  if (!key || !secret || !refresh) return null
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  })
  if (!res.ok) {
    console.error('dropbox token error', res.status, (await res.text()).slice(0, 300))
    return null
  }
  return ((await res.json()) as { access_token?: string }).access_token ?? null
}

export async function POST(request: Request) {
  if (!(await isSignedIn(request))) return json({ error: 'unauthorized' }, 401)

  const params = new URL(request.url).searchParams
  const project = params.get('project') ?? ''
  const order = params.get('order') ?? ''
  const kind = params.get('kind') ?? 'support'
  const folder = PROJECT_FOLDER[project]
  if (!folder || !/^[0-9A-Za-z-]{1,20}$/.test(order) || !['support', 'order'].includes(kind)) {
    return json({ error: 'bad request' }, 400)
  }

  const body = new Uint8Array(await request.arrayBuffer())
  if (body.length === 0 || String.fromCharCode(...body.slice(0, 4)) !== '%PDF') return json({ error: 'not_pdf' }, 400)
  if (body.length > MAX_BYTES) return json({ error: 'too_large' }, 413)

  const token = await accessToken()
  if (!token) return json({ error: 'not_configured' }, 503)

  const fileName = kind === 'support' ? `Soporte Orden ${order}.pdf` : `${project} Orden de Pago ${order}.pdf`
  const path = `${ROOT}/${folder}/${order}/${fileName}`

  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': headerJson({ path, mode: 'overwrite', autorename: false, mute: true }),
      'Content-Type': 'application/octet-stream',
    },
    body,
  })
  if (!res.ok) {
    console.error('dropbox upload error', res.status, (await res.text()).slice(0, 400))
    return json({ error: 'upload_failed', status: res.status }, 502)
  }
  return json({ path })
}

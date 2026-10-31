// Adds an order created in the app (or, with action=remove, takes it out again) to the Excel workbook that holds the payment
// history in Dropbox (one row in the payments sheet and, for Harbour House, the
// order's tab). While EXCEL_SYNC_LIVE is not "1" it only writes to a test copy next
// to the real workbook, so the real one is never touched during testing. In live
// mode the real file is replaced only if nobody changed it in the meantime.
// Requires a valid Supabase session and the Dropbox env vars of the other functions.
import { applyOrder, removeOrder, type SyncOrder } from './_excel.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })

const ROOT = process.env.DROPBOX_PAGOS_ROOT || '/pering/ijp/mar azul - todo/mar azul. personal/obra/1. Pagos'
const VT_DIR = process.env.DROPBOX_VT_DIR || '/PERING/0. Proyectos Pipeline/3. WRJ Vermont TODO/1. WRJ Vermont Personal/2. CM WRJ/2.3 Payments WRJ'
const FILES: Record<string, { dir: string; name: string }> = {
  HH: { dir: ROOT, name: 'Pagos Harbour House' },
  VT: { dir: VT_DIR, name: 'Payments WRJ' },
}

const headerJson = (o: unknown) =>
  JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

async function signedIn(request: Request): Promise<boolean> {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const auth = request.headers.get('authorization')
  if (!url || !anon || !auth) return false
  return (await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } })).ok
}

async function loadOrder(request: Request, project: string, order: string): Promise<SyncOrder | null> {
  const url = process.env.VITE_SUPABASE_URL!
  const res = await fetch(
    `${url}/rest/v1/payment_orders?project=eq.${encodeURIComponent(project)}&order_no=eq.${encodeURIComponent(order)}&select=*&limit=1`,
    { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY!, Authorization: request.headers.get('authorization')! } }
  )
  if (!res.ok) return null
  return ((await res.json()) as SyncOrder[])[0] ?? null
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

async function download(token: string, path: string): Promise<{ bytes: Uint8Array; rev: string } | null> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': headerJson({ path }) },
  })
  if (!res.ok) return null
  const meta = JSON.parse(res.headers.get('dropbox-api-result') ?? '{}') as { rev?: string }
  return { bytes: new Uint8Array(await res.arrayBuffer()), rev: meta.rev ?? '' }
}

export async function POST(request: Request) {
  if (!(await signedIn(request))) return json({ error: 'unauthorized' }, 401)
  const params = new URL(request.url).searchParams
  const project = params.get('project') ?? ''
  const orderNo = params.get('order') ?? ''
  const cfg = FILES[project]
  if (!cfg || !/^[0-9A-Za-z-]{1,20}$/.test(orderNo)) return json({ error: 'bad request' }, 400)

  const token = await dropboxToken()
  if (!token) return json({ error: 'not_configured' }, 503)
  const removing = params.get('action') === 'remove'
  const order = removing ? null : await loadOrder(request, project, orderNo)
  if (!removing && !order) return json({ error: 'order_not_found' }, 404)

  const live = process.env.EXCEL_SYNC_LIVE === '1'
  const realPath = `${cfg.dir}/${cfg.name}.xlsm`
  const testPath = `${cfg.dir}/${cfg.name} (prueba app).xlsm`

  // Test mode keeps building on its own copy; the first time it starts from the real file.
  const src = live ? await download(token, realPath) : (await download(token, testPath)) ?? (await download(token, realPath))
  if (!src) return json({ error: 'excel_not_found' }, 404)

  let result: { bytes: Uint8Array; row: number | null; status: string; tab: string }
  try {
    result = removing ? removeOrder(src.bytes, project, orderNo) : applyOrder(src.bytes, order!)
  } catch (e) {
    console.error('excel sync error', e instanceof Error ? e.message : e)
    return json({ error: 'excel_unreadable', detail: e instanceof Error ? e.message.slice(0, 120) : 'error' }, 422)
  }
  if (result.status === 'already' || result.status === 'absent') return json({ mode: live ? 'live' : 'test', status: result.status, row: result.row })

  const target = live ? realPath : testPath
  const up = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': headerJson({
        path: target,
        mode: live ? { '.tag': 'update', update: src.rev } : 'overwrite',
        autorename: false,
        mute: true,
      }),
      'Content-Type': 'application/octet-stream',
    },
    body: new Blob([result.bytes as BlobPart]),
  })
  if (!up.ok) {
    const text = await up.text()
    console.error('excel upload error', up.status, text.slice(0, 300))
    if (up.status === 409 && text.includes('conflict')) return json({ error: 'conflict' }, 409)
    return json({ error: 'upload_failed', status: up.status }, 502)
  }
  return json({ mode: live ? 'live' : 'test', status: result.status, row: result.row, tab: result.tab, file: target.split('/').pop() })
}

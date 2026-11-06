// Removes the files this app saved for one payment order from Dropbox (the
// supplier's invoice and/or the generated order PDF). The order's folder is never
// removed. Only those two exact file names are ever touched, never anything else
// in the folder. Dropbox keeps deleted files in "Deleted files", so
// they can still be restored from there for a while. Requires a valid Supabase
// session.

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
const pad4 = (o: string) => (/^\d+$/.test(o) ? o.padStart(4, '0') : o)
// Where each project keeps its orders in Dropbox, and how its files are named.
const PROJECTS: Record<string, { dir: string; folder: (o: string) => string; order: (o: string) => string; support: (o: string) => string }> = {
  HH: {
    dir: `${ROOT}/Pagos BH`,
    folder: (o) => o,
    order: (o) => `HH Orden de Pago ${o}.pdf`,
    support: (o) => `Soporte Orden ${o}.pdf`,
  },
  VT: {
    dir: process.env.DROPBOX_VT_DIR || '/PERING/0. Proyectos Pipeline/3. WRJ Vermont TODO/1. WRJ Vermont Personal/2. CM WRJ/2.3 Payments WRJ',
    folder: (o) => `VT-${pad4(o)}`,
    order: (o) => `Orden de Pago VT ${pad4(o)}.pdf`,
    support: (o) => `Soporte Orden VT ${pad4(o)}.pdf`,
  },
  PGM: {
    dir: process.env.DROPBOX_PGM_DIR || '/PERING/IJP/0 - PGM CONST GEN',
    folder: (o) => `PGM ${pad4(o)}`,
    order: (o) => `Orden de Pago PGM ${pad4(o)}.pdf`,
    support: (o) => `Soporte Orden PGM ${pad4(o)}.pdf`,
  },
}

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
  if (!res.ok) return null
  return ((await res.json()) as { access_token?: string }).access_token ?? null
}

async function dbx(token: string, endpoint: string, body: unknown) {
  return fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function POST(request: Request) {
  if (!(await isSignedIn(request))) return json({ error: 'unauthorized' }, 401)

  const params = new URL(request.url).searchParams
  const project = params.get('project') ?? ''
  const order = params.get('order') ?? ''
  const kinds = (params.get('files') ?? '').split(',').filter((k) => k === 'support' || k === 'order')
  const cfg = PROJECTS[project]
  if (!cfg || !/^[0-9A-Za-z-]{1,20}$/.test(order) || kinds.length === 0) return json({ error: 'bad request' }, 400)

  const token = await accessToken()
  if (!token) return json({ error: 'not_configured' }, 503)

  const dir = `${cfg.dir}/${cfg.folder(order)}`
  const names = kinds.map((k) => (k === 'support' ? cfg.support(order) : cfg.order(order)))

  for (const name of names) {
    const res = await dbx(token, 'files/delete_v2', { path: `${dir}/${name}` })
    if (!res.ok) {
      const text = await res.text()
      // A file that is already gone counts as deleted.
      if (!(res.status === 409 && text.includes('not_found'))) {
        console.error('dropbox delete error', res.status, text.slice(0, 300))
        return json({ error: 'delete_failed', status: res.status }, 502)
      }
    }
  }

  // The order's folder is always kept (it may hold other documents), even when empty.
  return json({ deleted: names, folderRemoved: false })
}

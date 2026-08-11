import { Hono } from 'hono'

/**
 * In-app update manifest for the Picly desktop app.
 *
 * The desktop renderer calls `app:check-update` (main.cjs -> GET /app/update)
 * and compares `version` against the packaged app version. When a new release
 * is published, bump `version` + `url` here (or serve this from a static file
 * / DB in production).
 */
export interface UpdateManifest {
  version: string
  url: string
  notes: string[]
}

const manifest: UpdateManifest = {
  version: '1.0.0',
  url: 'https://github.com/rizkhal/picly/releases/latest',
  notes: [
    'Local-first desktop app — scan, search and manage photos fully offline.',
    'Backend now serves only the in-app update manifest.',
  ],
}

export const update = new Hono()

update.get('/', (c) => c.json({ available: true, manifest }))

// Convenience: renderer checks availability directly
update.get('/check', (c) => {
  const current = c.req.query('current')
  const available = current !== manifest.version
  return c.json({ available, current: current ?? null, latest: manifest.version, url: manifest.url, notes: manifest.notes })
})

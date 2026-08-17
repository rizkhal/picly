import { Hono } from 'hono'

/**
 * In-app update manifest for the Picly desktop app.
 *
 * The desktop renderer calls `app:check-update` (main.cjs -> GET /app/update)
 * and compares `version` against the packaged app version. When a new release
 * is published, bump `version` + `url` here (or serve this from a static file
 * / DB in production).
 *
 * `models` lists the ML models bundled with this release. Models are shipped
 * INSIDE the app (Contents/Resources/models), so a model upgrade ships as a
 * new app release. The desktop shows the latest model versions in Settings ->
 * Update so users know the release includes new models, and it detects a model
 * mismatch on startup.
 */
export interface UpdateManifest {
  version: string
  url: string
  notes: string[]
  models: {
    detector: string
    recognizer: string
    quality: string
  }
}

const manifest: UpdateManifest = {
  version: '1.0.1',
  url: 'https://github.com/rizkhal/picly/releases/latest',
  notes: [
    'Person avatars: upload a photo and crop it (resize corner to zoom).',
    'New Scan photos page with drag & drop folder upload and per-file progress.',
    'Manage photos: library overview with folder breakdown + storage stats, and a cleanup section.',
    'Global search by person name; link unassigned faces from the photo detail.',
    'Detection: pose + false-positive angle gate to reject banners/shoulders.',
  ],
  models: {
    detector: 'det_10g',
    recognizer: 'w600k_r50',
    quality: 'ediffiqa_t',
  },
}

export const update = new Hono()

update.get('/', (c) => c.json({ available: true, manifest }))

// Convenience: renderer checks availability directly
update.get('/check', (c) => {
  const current = c.req.query('current')
  const available = current !== manifest.version
  return c.json({ available, current: current ?? null, latest: manifest.version, url: manifest.url, notes: manifest.notes, models: manifest.models })
})

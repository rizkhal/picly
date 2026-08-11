import { Hono } from 'hono'
import { serve } from 'bun'
import { system } from './routes/system'
import { update } from './update'

const app = new Hono()

// Root / system routes
app.route('/', system)

// In-app update manifest for the desktop app
app.route('/app/update', update)

// Global error handling — always return JSON
app.onError((err, c) => {
  console.error('backend error:', err)
  return c.json({ error: 'internal_error', message: err.message }, 500)
})

// 404 as JSON
app.notFound((c) => c.json({ error: 'not_found', message: `${c.req.method} ${c.req.path}` }, 404))

// Explicit listen — port overridable via PORT (Docker maps 8000 -> container PORT)
const port = Number(process.env.PORT) || 8000

serve({ fetch: app.fetch, port })

export default app

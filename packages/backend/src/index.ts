import { Hono } from 'hono'
import { serve } from 'bun'
import { system } from './routes/system'
import { update } from './update'
import { auth } from './auth'

const app = new Hono()

// Root / system routes
app.route('/', system)

// Auth (register/login/refresh/logout)
app.route('/auth', auth)

// In-app update manifest for the desktop app
app.route('/app/update', update)

// Global error handling — always return JSON
app.onError((err, c) => {
  console.error('backend error:', err)
  return c.json({ error: 'internal_error', message: err.message }, 500)
})

// 404 as JSON
app.notFound((c) => c.json({ error: 'not_found', message: `${c.req.method} ${c.req.path}` }, 404))

// Explicit listen — port overridable via PORT (Docker maps 9999 -> container PORT)
// Note: no `export default` here — exporting the app makes Bun auto-serve it on
// port 3000 on top of our explicit serve(), causing EADDRINUSE. Manual serve only.
const port = Number(process.env.PORT) || 9999

serve({ fetch: app.fetch, port })

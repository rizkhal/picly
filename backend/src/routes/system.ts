import { Hono } from 'hono'

export const system = new Hono()

system.get('/', (c) => c.json({ name: 'picly-backend', ok: true }))

system.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }))

// Readiness — backend is stateless (no DB dependency yet)
system.get('/ready', (c) => c.json({ ready: true }))

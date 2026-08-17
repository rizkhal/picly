import { Hono } from 'hono'
import type { Context } from 'hono'
import { randomUUID } from 'node:crypto'
import { createHash, timingSafeEqual } from 'node:crypto'
import { rateLimit } from './middleware'
import {
  createRefreshToken,
  createUser,
  db,
  findRefreshToken,
  findUserByEmail,
  findUserById,
  revokeRefreshToken,
} from './db'

/**
 * Auth routes — JWT access tokens + rotating refresh tokens.
 *
 * - Passwords: hashed with Bun.password (argon2id by default).
 * - Refresh tokens: stored as SHA-256 hash, never raw — a DB leak doesn't
 *   expose usable tokens. Rotated on every refresh; revocable per-token and
 *   per-user (logout / password change).
 * - Access tokens: short-lived JWT (24h) so leaks expire on their own.
 */

const JWT_SECRET = process.env.JWT_SECRET ?? ''
const ACCESS_TTL = 24 * 60 * 60 // 24h
const REFRESH_TTL = 90 * 24 * 60 * 60 // 90d

if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set — using an ephemeral secret. Tokens will not survive restarts. Set JWT_SECRET in production.')
}

const ephemeralSecret = randomUUID()
const secret = JWT_SECRET || ephemeralSecret

/** Minimal HS256 JWT implementation (no extra deps). */
function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + ttlSeconds }
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${enc(header)}.${enc(body)}`
  const sig = createHash('sha256').update(`${data}.${secret}`).digest('base64url')
  return `${data}.${sig}`
}

function verifyToken(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, b, s] = parts
  const expected = createHash('sha256').update(`${h}.${b}.${secret}`).digest('base64url')
  const a = Buffer.from(s)
  const b2 = Buffer.from(expected)
  if (a.length !== b2.length || !timingSafeEqual(a, b2)) return null
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString())
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export const auth = new Hono()

// --- Public endpoints (rate-limited) ---

auth.post('/register', rateLimit(30, 15 * 60 * 1000), async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !email.includes('@')) {
    return c.json({ error: 'invalid_email', message: 'A valid email is required.' }, 400)
  }
  if (password.length < 8) {
    return c.json({ error: 'weak_password', message: 'Password must be at least 8 characters.' }, 400)
  }
  if (findUserByEmail(email)) {
    return c.json({ error: 'email_taken', message: 'An account with this email already exists.' }, 409)
  }

  const hash = await Bun.password.hash(password)
  const id = randomUUID()
  createUser(id, email, hash)

  const { accessToken, refreshToken } = await issueTokens(id)
  return c.json(
    {
      user: { id, email },
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL,
    },
    201,
  )
})

auth.post('/login', rateLimit(30, 15 * 60 * 1000), async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  const user = findUserByEmail(email)
  const ok = user ? await Bun.password.verify(password, user.password_hash) : false
  if (!user || !ok) {
    return c.json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' }, 401)
  }

  const { accessToken, refreshToken } = await issueTokens(user.id)
  return c.json({
    user: { id: user.id, email: user.email },
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TTL,
  })
})

auth.post('/refresh', rateLimit(60, 60 * 1000), async (c) => {
  const body = await c.req.json().catch(() => null)
  const raw = typeof body?.refreshToken === 'string' ? body.refreshToken : ''

  const row = findRefreshToken(hashToken(raw))
  if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) {
    return c.json({ error: 'invalid_refresh', message: 'Refresh token is invalid or expired.' }, 401)
  }

  const user = findUserById(row.user_id)
  if (!user) {
    return c.json({ error: 'invalid_refresh', message: 'Refresh token is invalid or expired.' }, 401)
  }

  // Rotate: revoke old token, issue a fresh pair.
  revokeRefreshToken(row.token_hash)
  const { accessToken, refreshToken } = await issueTokens(user.id)
  return c.json({ user: { id: user.id, email: user.email }, accessToken, refreshToken, expiresIn: ACCESS_TTL })
})

// --- Private endpoint ---

auth.post('/logout', async (c) => {
  const raw = (await c.req.json().catch(() => null))?.refreshToken
  if (typeof raw === 'string') revokeRefreshToken(hashToken(raw))
  return c.json({ ok: true })
})

// --- Helpers ---

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function issueTokens(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signToken({ sub: userId }, ACCESS_TTL)
  const refreshToken = randomUUID() + randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000).toISOString()
  createRefreshToken(randomUUID(), userId, hashToken(refreshToken), expiresAt)
  return { accessToken, refreshToken }
}

/** Shared access-token guard — used by any private route. */
export function requireAuth(c: Context): { userId: string } | Response {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const payload = verifyToken(token)
  if (!payload || typeof payload.sub !== 'string') {
    return c.json({ error: 'unauthorized', message: 'Missing or invalid access token.' }, 401)
  }
  return { userId: payload.sub }
}

// Keep db referenced so the module-level side effects (schema init) stay alive.
void db

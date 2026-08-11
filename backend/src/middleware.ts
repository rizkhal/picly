import type { Context, Next } from 'hono'
import { getConnInfo } from 'hono/bun'

/**
 * In-memory sliding-window rate limiter, keyed by client IP.
 *
 * Backend is a single process behind one proxy — good enough for v1
 * (brute-force guard + abuse protection). If this ever runs multi-instance,
 * swap for a shared store (Redis / Postgres) or move it to the proxy/CDN.
 */
interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function rateLimit(limit: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    const info = getConnInfo(c)
    const key = info.remote.address ?? 'unknown'
    const now = Date.now()

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1

    const remaining = limit - bucket.count
    c.header('X-RateLimit-Limit', String(limit))
    c.header('X-RateLimit-Remaining', String(Math.max(0, remaining)))

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'rate_limited', message: `Too many requests. Retry after ${retryAfter}s.` }, 429)
    }
    await next()
  }
}

/** Periodic cleanup so the map doesn't grow forever. */
setInterval(() => {
  const now = Date.now()
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key)
  }
}, 60_000).unref()

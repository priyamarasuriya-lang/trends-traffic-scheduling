// Fixed-window in-memory limiter. Adequate for a single instance; for
// horizontally scaled deployments swap in a shared store (see docs/SECURITY.md).
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (buckets.size > 10000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  return { ok: b.count <= limit, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

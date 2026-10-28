import crypto from 'crypto';

/** Constant-time string comparison so secrets can't be guessed via response timing. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks a shared secret sent as `Authorization: Bearer <secret>`, `x-webhook-secret: <secret>`
 * or `?key=<secret>`. Fails closed when the secret is not configured.
 */
export function hasValidSecret(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;

  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ') && safeEqual(authHeader.slice(7), secret)) return true;

  const headerSecret = req.headers.get('x-webhook-secret');
  if (headerSecret && safeEqual(headerSecret, secret)) return true;

  const queryKey = new URL(req.url).searchParams.get('key');
  return !!queryKey && safeEqual(queryKey, secret);
}

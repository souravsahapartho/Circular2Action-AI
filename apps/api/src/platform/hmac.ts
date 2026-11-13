import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export function signInternal(secret: string, timestampMs: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampMs}.${body}`).digest('hex');
}

/** Remembers recently seen signatures so a captured request cannot be replayed inside the window. */
export class ReplayCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number = SIGNATURE_WINDOW_MS * 2) {}

  /** Returns true if the signature is new (and records it); false if it was already seen. */
  remember(signature: string, nowMs: number): boolean {
    for (const [k, t] of this.seen) if (nowMs - t > this.ttlMs) this.seen.delete(k);
    if (this.seen.has(signature)) return false;
    this.seen.set(signature, nowMs);
    return true;
  }
}

export type VerifyResult = 'ok' | 'bad_signature' | 'expired' | 'replayed' | 'malformed';

/** Verify an HMAC-signed internal request (plan T-18). Accepts any configured secret (rotation). */
export function verifyInternal(args: {
  secrets: readonly string[];
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
  nowMs: number;
  replay: ReplayCache;
}): VerifyResult {
  const { secrets, timestamp, signature, body, nowMs, replay } = args;
  if (
    !timestamp ||
    !signature ||
    !/^\d{10,16}$/.test(timestamp) ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return 'malformed';
  const ts = Number(timestamp);
  if (Math.abs(nowMs - ts) > SIGNATURE_WINDOW_MS) return 'expired';
  const given = Buffer.from(signature, 'hex');
  const matches = secrets.some((s) => {
    const expected = Buffer.from(signInternal(s, ts, body), 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!matches) return 'bad_signature';
  return replay.remember(signature, nowMs) ? 'ok' : 'replayed';
}

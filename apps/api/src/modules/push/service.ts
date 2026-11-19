import { createHash } from 'node:crypto';
import webpush from 'web-push';
import type { Clock } from '../../platform/clock';
import type { Db, Row } from '../../db/pool';

/** Push services whose endpoints we accept. The server posts to the stored endpoint, so this list is the SSRF guard. */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'push.apple.com',
  'notify.windows.com',
];

export function isPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const h = u.hostname.toLowerCase();
    return PUSH_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

export const PUSH_TYPES = [
  'job_match',
  'deadline_reminder',
  'application_update',
  'new_application',
  'announcement',
] as const;
export type PushType = (typeof PUSH_TYPES)[number];

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const STATUS_EN: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  accepted: 'Accepted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};
const STATUS_BN: Record<string, string> = {
  submitted: 'জমা হয়েছে',
  under_review: 'পর্যালোচনায়',
  shortlisted: 'বাছাইকৃত',
  interview: 'ইন্টারভিউ',
  accepted: 'গৃহীত',
  rejected: 'নির্বাচিত হননি',
  withdrawn: 'প্রত্যাহার',
};

const s = (v: unknown, max = 140): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** The text of a push, in the person's language. Pure, so it is easy to test. */
export function pushText(
  type: string,
  params: Record<string, unknown>,
  subject: { type: string | null; id: string | null },
  locale: string,
  isEmployer: boolean,
): PushPayload | null {
  const bn = locale === 'bn';
  const L = bn ? 'bn' : 'en';
  const opp =
    subject.type === 'opportunity' && subject.id ? `/${L}/opportunities/x-${subject.id}` : `/${L}`;
  const title = bn
    ? s(params.title_alt) || s(params.title)
    : s(params.title) || s(params.title_alt);
  switch (type) {
    case 'job_match':
      return {
        title: bn ? 'নতুন মিল পাওয়া গেছে' : 'New match for you',
        body: title,
        url: opp,
        tag: `match-${subject.id}`,
      };
    case 'deadline_reminder':
      return {
        title: bn ? 'শেষ তারিখ ঘনিয়ে আসছে' : 'Closing soon',
        body: title,
        url: opp,
        tag: `deadline-${subject.id}`,
      };
    case 'application_update': {
      const st = (bn ? STATUS_BN : STATUS_EN)[s(params.status)] ?? s(params.status);
      return {
        title: bn ? 'আবেদনের আপডেট' : 'Application update',
        body: `${s(params.tracking_code, 20)} · ${st}`,
        url: `/${L}/app/applications/${subject.id ?? ''}`,
        tag: `app-${subject.id}`,
      };
    }
    case 'new_application':
      return {
        title: 'New application',
        body: title,
        url: isEmployer ? `/employer/applications/${subject.id ?? ''}` : `/${L}`,
        tag: `newapp-${subject.id}`,
      };
    case 'announcement':
      return {
        title: s(params.title, 80) || 'Circular2Action',
        body: s(params.message, 160),
        url: isEmployer ? '/employer' : `/${L}/app/notifications`,
        tag: 'announcement',
      };
    default:
      return null;
  }
}

export type SendFn = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<void>;

export interface PushConfig {
  publicKey?: string | undefined;
  privateKey?: string | undefined;
  subject?: string | undefined;
}

/** Web push: stores each device's subscription and sends the notifications people have not read yet. */
export class PushService {
  private readonly send: SendFn | null;
  private flushing = false;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly cfg: PushConfig = {},
    send?: SendFn,
  ) {
    if (send) {
      this.send = send;
    } else if (cfg.publicKey && cfg.privateKey) {
      webpush.setVapidDetails(
        cfg.subject ?? 'mailto:admin@example.com',
        cfg.publicKey,
        cfg.privateKey,
      );
      this.send = async (sub, payload) => {
        await webpush.sendNotification(sub, payload, { TTL: 86_400, urgency: 'normal' });
      };
    } else {
      this.send = null;
    }
  }

  get enabled(): boolean {
    return this.send !== null;
  }

  get publicKey(): string | null {
    return this.cfg.publicKey ?? null;
  }

  async subscribe(
    userId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent: string | null,
  ): Promise<void> {
    const hash = createHash('sha256').update(sub.endpoint).digest();
    await this.db.execute(
      `INSERT INTO push_subscriptions (user_id, endpoint_hash, endpoint, p256dh, auth, user_agent)
       VALUES (:u, :h, :e, :p, :a, :ua)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), failures = 0`,
      {
        u: userId,
        h: hash,
        e: sub.endpoint,
        p: sub.keys.p256dh,
        a: sub.keys.auth,
        ua: userAgent ? userAgent.slice(0, 200) : null,
      },
    );
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM push_subscriptions WHERE user_id = :u AND endpoint_hash = :h',
      {
        u: userId,
        h: createHash('sha256').update(endpoint).digest(),
      },
    );
  }

  async localeOf(userId: string): Promise<string> {
    const [r] = await this.db.query<Row & { locale: string }>(
      'SELECT locale FROM users WHERE id = :u',
      { u: userId },
    );
    return r?.locale ?? 'bn';
  }

  async deviceCount(userId: string): Promise<number> {
    const [r] = await this.db.query<Row & { n: number }>(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = :u',
      { u: userId },
    );
    return Number(r?.n ?? 0);
  }

  /** Types the person switched off for push. Everything is on by default. */
  async disabledTypes(userId: string): Promise<string[]> {
    const rows = await this.db.query<Row & { type: string }>(
      "SELECT type FROM notification_preferences WHERE user_id = :u AND channel = 'push' AND enabled = 0",
      { u: userId },
    );
    return rows.map((r) => String(r.type));
  }

  async setType(userId: string, type: PushType, enabled: boolean): Promise<void> {
    await this.db.execute(
      `INSERT INTO notification_preferences (user_id, type, channel, enabled) VALUES (:u, :t, 'push', :e)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      { u: userId, t: type, e: enabled ? 1 : 0 },
    );
  }

  /**
   * Sends the unread notifications of people who have a subscribed device. Each notification is claimed first
   * (pushed_at), so it is sent once even if two flushes overlap. Never throws.
   */
  async flush(limit = 100): Promise<{ sent: number; skipped: number }> {
    if (!this.send || this.flushing) return { sent: 0, skipped: 0 };
    this.flushing = true;
    try {
      const now = this.clock.now();
      const since = new Date(now.getTime() - 86_400_000);
      const n = Math.max(1, Math.min(500, Math.floor(limit)));
      const rows = await this.db.query<
        Row & {
          id: string;
          user_id: string;
          type: string;
          subject_type: string | null;
          subject_id: string | null;
          params: unknown;
          locale: string;
          is_employer: number;
        }
      >(
        `SELECT n.id, n.user_id, n.type, n.subject_type, n.subject_id, n.params, u.locale,
                EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = n.user_id AND r.role = 'employer') AS is_employer
         FROM notifications n JOIN users u ON u.id = n.user_id
         WHERE n.pushed_at IS NULL AND n.read_at IS NULL AND n.created_at > :since
           AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = n.user_id)
         ORDER BY n.created_at LIMIT ${n}`,
        { since },
      );
      let sent = 0;
      let skipped = 0;
      const offCache = new Map<string, string[]>();
      for (const row of rows) {
        const claim = await this.db.execute(
          'UPDATE notifications SET pushed_at = :now WHERE id = :id AND pushed_at IS NULL',
          { now, id: String(row.id) },
        );
        if (claim.affectedRows === 0) continue;
        const uid = String(row.user_id);
        if (!offCache.has(uid)) offCache.set(uid, await this.disabledTypes(uid));
        if (offCache.get(uid)!.includes(row.type)) {
          skipped++;
          continue;
        }
        const params =
          typeof row.params === 'string'
            ? (JSON.parse(row.params) as Record<string, unknown>)
            : ((row.params as Record<string, unknown> | null) ?? {});
        const payload = pushText(
          row.type,
          params,
          { type: row.subject_type, id: row.subject_id ? String(row.subject_id) : null },
          row.locale,
          Number(row.is_employer) === 1,
        );
        if (!payload) {
          skipped++;
          continue;
        }
        sent += await this.deliver(uid, payload);
      }
      return { sent, skipped };
    } catch {
      return { sent: 0, skipped: 0 };
    } finally {
      this.flushing = false;
    }
  }

  /** A test push to the person's own devices. Returns how many devices accepted it. */
  async test(userId: string, locale: string): Promise<number> {
    if (!this.send) return 0;
    const bn = locale === 'bn';
    return this.deliver(userId, {
      title: 'Circular2Action',
      body: bn ? 'পুশ নোটিফিকেশন কাজ করছে।' : 'Push notifications are working.',
      url: bn ? '/bn' : '/en',
      tag: 'test',
    });
  }

  /** Sends one payload to every device of a person. Returns how many devices accepted it. */
  private async deliver(userId: string, payload: PushPayload): Promise<number> {
    const subs = await this.db.query<
      Row & { id: string; endpoint: string; p256dh: string; auth: string; failures: number }
    >(
      'SELECT id, endpoint, p256dh, auth, failures FROM push_subscriptions WHERE user_id = :u LIMIT 10',
      {
        u: userId,
      },
    );
    const body = JSON.stringify(payload);
    let ok = 0;
    for (const sub of subs) {
      if (!isPushEndpoint(sub.endpoint)) {
        await this.db.execute('DELETE FROM push_subscriptions WHERE id = :id', {
          id: String(sub.id),
        });
        continue;
      }
      try {
        await this.send!(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        ok++;
        await this.db.execute(
          'UPDATE push_subscriptions SET last_ok_at = :now, failures = 0 WHERE id = :id',
          { now: this.clock.now(), id: String(sub.id) },
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410 || Number(sub.failures) >= 4) {
          await this.db.execute('DELETE FROM push_subscriptions WHERE id = :id', {
            id: String(sub.id),
          });
        } else {
          await this.db.execute(
            'UPDATE push_subscriptions SET failures = failures + 1 WHERE id = :id',
            {
              id: String(sub.id),
            },
          );
        }
      }
    }
    return ok;
  }
}

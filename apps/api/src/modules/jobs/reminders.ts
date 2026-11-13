import { createHash } from 'node:crypto';

/**
 * Reminder materialisation (plan F-02, SCH-10). Reminders are derived from data by a watermark, never stored as a
 * schedule. A reminder that became due during an outage is sent late inside a grace window, otherwise skipped with
 * an audit record; reminders after the deadline are never sent.
 */
export interface ReminderItem {
  userId: string;
  opportunityId: string;
  deadlineAt: Date;
  /** when the user saved or tracked it: slots earlier than this are skipped (F-02) */
  savedAt: Date;
}

export interface ReminderOptions {
  offsetsHours: readonly number[];
  now: Date;
  /** everything up to this instant was already considered by a previous run */
  watermark: Date;
  graceMs?: number;
  existingKeys?: ReadonlySet<string>;
}

export interface Reminder {
  userId: string;
  opportunityId: string;
  offsetHours: number;
  slotAt: Date;
  dedupeKey: string;
  late: boolean;
}

export type SkipReason =
  'missed_grace' | 'deadline_passed' | 'before_saved' | 'already_materialised';

export interface MaterialiseResult {
  send: Reminder[];
  skipped: Array<Reminder & { reason: SkipReason }>;
}

export const DEFAULT_GRACE_MS = 6 * 3600_000;

export function reminderKey(
  userId: string,
  opportunityId: string,
  slotAt: Date,
  channel = 'in_app',
): string {
  return createHash('sha256')
    .update(`deadline_reminder|${userId}|${opportunityId}|${slotAt.toISOString()}|${channel}`)
    .digest('hex');
}

export function materialiseReminders(
  items: readonly ReminderItem[],
  opts: ReminderOptions,
): MaterialiseResult {
  const grace = opts.graceMs ?? DEFAULT_GRACE_MS;
  const send: Reminder[] = [];
  const skipped: MaterialiseResult['skipped'] = [];
  const nowMs = opts.now.getTime();
  const markMs = opts.watermark.getTime();

  for (const item of items) {
    for (const offset of opts.offsetsHours) {
      const slotAt = new Date(item.deadlineAt.getTime() - offset * 3600_000);
      const slotMs = slotAt.getTime();
      if (slotMs <= markMs || slotMs > nowMs) continue; // not newly due in this window
      const reminder: Reminder = {
        userId: item.userId,
        opportunityId: item.opportunityId,
        offsetHours: offset,
        slotAt,
        dedupeKey: reminderKey(item.userId, item.opportunityId, slotAt),
        late: nowMs - slotMs > 15 * 60_000,
      };
      if (opts.existingKeys?.has(reminder.dedupeKey)) {
        skipped.push({ ...reminder, reason: 'already_materialised' });
      } else if (slotMs < item.savedAt.getTime()) {
        skipped.push({ ...reminder, reason: 'before_saved' });
      } else if (nowMs >= item.deadlineAt.getTime()) {
        skipped.push({ ...reminder, reason: 'deadline_passed' });
      } else if (nowMs - slotMs > grace) {
        skipped.push({ ...reminder, reason: 'missed_grace' });
      } else {
        send.push(reminder);
      }
    }
  }
  return { send, skipped };
}

import type { EducationRecord, Profile } from '@c2a/eligibility';
import type { Db, Row } from '../../db/pool';

export const APPLICATION_STATUSES = [
  'interested',
  'preparing',
  'ready_to_apply',
  'applied',
  'exam_scheduled',
  'interview',
  'selected',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface ProfileRow {
  date_of_birth: string | null;
  gender: 'female' | 'male' | 'other' | null;
  nationality_country: string;
  home_district_id: string | null;
  current_district_id: string | null;
  headline: string | null;
  preferences: Record<string, unknown> | null;
  profile_version: number;
}

export interface EducationRow {
  id: string;
  level: string;
  institution_other: string | null;
  discipline_other: string | null;
  degree_title: string | null;
  result_scale: string | null;
  result_value: number | null;
  result_class: string | null;
  status: string;
  start_year: number | null;
  passing_year: number | null;
}

export interface EducationInput {
  level: string;
  institution_other?: string | null;
  discipline_other?: string | null;
  degree_title?: string | null;
  result_scale?: string | null;
  result_value?: number | null;
  result_class?: string | null;
  status: string;
  start_year?: number | null;
  passing_year?: number | null;
}

export interface ApplicationRow {
  id: string;
  opportunity_id: string | null;
  title: string;
  organization: string | null;
  url: string | null;
  deadline_at: string | null;
  status: ApplicationStatus;
  applied_at: string | null;
  exam_at: string | null;
  interview_at: string | null;
  follow_up_at: string | null;
  payment_status: string | null;
  amount_paid: number | null;
  notes: string | null;
  updated_at: string;
  created_at: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dateOnly = (d: Date | string | null | undefined) =>
  d === null || d === undefined
    ? null
    : typeof d === 'string'
      ? d.slice(0, 10)
      : d.toISOString().slice(0, 10);

/** Profile, saved items and tracker SQL. Every query takes `userId` and filters by it (SEC-07). */
export class MeRepo {
  constructor(private readonly db: Db) {}

  // ---- profile ----

  async getProfile(userId: string): Promise<ProfileRow> {
    const rows = await this.db.query<
      Row & {
        date_of_birth: Date | string | null;
        gender: ProfileRow['gender'];
        nationality_country: string;
        home_district_id: string | null;
        current_district_id: string | null;
        headline: string | null;
        preferences: Record<string, unknown> | string | null;
        profile_version: number;
      }
    >('SELECT * FROM user_profiles WHERE user_id = :id', { id: userId });
    const r = rows[0];
    if (!r) {
      return {
        date_of_birth: null,
        gender: null,
        nationality_country: 'BD',
        home_district_id: null,
        current_district_id: null,
        headline: null,
        preferences: null,
        profile_version: 0,
      };
    }
    return {
      date_of_birth: dateOnly(r.date_of_birth),
      gender: r.gender,
      nationality_country: r.nationality_country,
      home_district_id: r.home_district_id === null ? null : String(r.home_district_id),
      current_district_id: r.current_district_id === null ? null : String(r.current_district_id),
      headline: r.headline,
      preferences:
        typeof r.preferences === 'string'
          ? (JSON.parse(r.preferences) as Record<string, unknown>)
          : r.preferences,
      profile_version: Number(r.profile_version),
    };
  }

  /** Upserts the profile; the version increases because every field here can change an eligibility result. */
  async saveProfile(
    userId: string,
    p: Partial<Omit<ProfileRow, 'profile_version'>>,
  ): Promise<void> {
    const cur = await this.getProfile(userId);
    const next = { ...cur, ...p };
    await this.db.execute(
      `INSERT INTO user_profiles (user_id, date_of_birth, gender, nationality_country, home_district_id,
         current_district_id, headline, preferences, profile_version)
       VALUES (:id, :dob, :g, :nat, :home, :cur, :h, :pref, 1)
       ON DUPLICATE KEY UPDATE date_of_birth = VALUES(date_of_birth), gender = VALUES(gender),
         nationality_country = VALUES(nationality_country), home_district_id = VALUES(home_district_id),
         current_district_id = VALUES(current_district_id), headline = VALUES(headline),
         preferences = VALUES(preferences), profile_version = profile_version + 1`,
      {
        id: userId,
        dob: next.date_of_birth,
        g: next.gender,
        nat: next.nationality_country,
        home: next.home_district_id,
        cur: next.current_district_id,
        h: next.headline,
        pref: next.preferences === null ? null : JSON.stringify(next.preferences),
      },
    );
  }

  private async bumpVersion(userId: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO user_profiles (user_id, profile_version) VALUES (:id, 1)
       ON DUPLICATE KEY UPDATE profile_version = profile_version + 1`,
      { id: userId },
    );
  }

  async listEducation(userId: string): Promise<EducationRow[]> {
    const rows = await this.db.query<Row & EducationRow & { result_value: string | number | null }>(
      `SELECT id, level, institution_other, discipline_other, degree_title, result_scale, result_value,
              result_class, status, start_year, passing_year
       FROM education_records WHERE user_id = :id ORDER BY passing_year DESC, id`,
      { id: userId },
    );
    return rows.map((r) => ({
      ...r,
      id: String(r.id),
      result_value: r.result_value === null ? null : Number(r.result_value),
      start_year: r.start_year === null ? null : Number(r.start_year),
      passing_year: r.passing_year === null ? null : Number(r.passing_year),
    }));
  }

  async addEducation(userId: string, e: EducationInput): Promise<string> {
    const res = await this.db.execute(
      `INSERT INTO education_records (user_id, level, institution_other, discipline_other, degree_title,
         result_scale, result_value, result_class, status, start_year, passing_year)
       VALUES (:uid, :level, :inst, :disc, :deg, :scale, :val, :cls, :status, :sy, :py)`,
      {
        uid: userId,
        level: e.level,
        inst: e.institution_other ?? null,
        disc: e.discipline_other ?? null,
        deg: e.degree_title ?? null,
        scale: e.result_scale ?? null,
        val: e.result_value ?? null,
        cls: e.result_class ?? null,
        status: e.status,
        sy: e.start_year ?? null,
        py: e.passing_year ?? null,
      },
    );
    await this.bumpVersion(userId);
    return String(res.insertId);
  }

  async updateEducation(userId: string, id: string, e: EducationInput): Promise<boolean> {
    const res = await this.db.execute(
      `UPDATE education_records SET level = :level, institution_other = :inst, discipline_other = :disc,
         degree_title = :deg, result_scale = :scale, result_value = :val, result_class = :cls,
         status = :status, start_year = :sy, passing_year = :py
       WHERE id = :id AND user_id = :uid`,
      {
        id,
        uid: userId,
        level: e.level,
        inst: e.institution_other ?? null,
        disc: e.discipline_other ?? null,
        deg: e.degree_title ?? null,
        scale: e.result_scale ?? null,
        val: e.result_value ?? null,
        cls: e.result_class ?? null,
        status: e.status,
        sy: e.start_year ?? null,
        py: e.passing_year ?? null,
      },
    );
    if (res.affectedRows > 0) await this.bumpVersion(userId);
    return res.affectedRows > 0;
  }

  async deleteEducation(userId: string, id: string): Promise<boolean> {
    const res = await this.db.execute(
      'DELETE FROM education_records WHERE id = :id AND user_id = :uid',
      {
        id,
        uid: userId,
      },
    );
    if (res.affectedRows > 0) await this.bumpVersion(userId);
    return res.affectedRows > 0;
  }

  /** The eligibility engine's view of the saved profile (undefined = not provided). */
  async eligibilityProfile(userId: string): Promise<Profile> {
    const p = await this.getProfile(userId);
    const edu = await this.listEducation(userId);
    const education: EducationRecord[] = edu.map((e) => ({
      level: e.level as EducationRecord['level'],
      status: e.status as EducationRecord['status'],
      ...(e.result_scale && e.result_value !== null
        ? { resultScale: e.result_scale as 'gpa4', resultValue: e.result_value }
        : {}),
      ...(e.result_class ? { resultClass: e.result_class as 'first' } : {}),
      ...(e.start_year ? { startYear: e.start_year } : {}),
      ...(e.passing_year ? { passingYear: e.passing_year } : {}),
      ...(e.discipline_other ? { disciplineOther: e.discipline_other } : {}),
    }));
    return {
      ...(p.date_of_birth ? { dateOfBirth: p.date_of_birth } : {}),
      ...(p.gender ? { gender: p.gender } : {}),
      nationality: p.nationality_country,
      ...(p.home_district_id ? { homeDistrictId: Number(p.home_district_id) } : {}),
      ...(p.current_district_id ? { currentDistrictId: Number(p.current_district_id) } : {}),
      ...(education.length > 0 ? { education } : {}),
    };
  }

  // ---- saved opportunities ----

  async save(userId: string, opportunityId: string): Promise<boolean> {
    const [o] = await this.db.query<Row & { id: string }>(
      "SELECT id FROM opportunities WHERE id = :id AND publication_status = 'published'",
      { id: opportunityId },
    );
    if (!o) return false;
    await this.db.execute(
      'INSERT IGNORE INTO saved_opportunities (user_id, opportunity_id) VALUES (:u, :o)',
      { u: userId, o: opportunityId },
    );
    return true;
  }

  async unsave(userId: string, opportunityId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM saved_opportunities WHERE user_id = :u AND opportunity_id = :o',
      {
        u: userId,
        o: opportunityId,
      },
    );
  }

  async savedIds(userId: string): Promise<string[]> {
    const rows = await this.db.query<Row & { opportunity_id: string }>(
      'SELECT opportunity_id FROM saved_opportunities WHERE user_id = :u ORDER BY created_at DESC',
      { u: userId },
    );
    return rows.map((r) => String(r.opportunity_id));
  }

  // ---- applications (tracker) ----

  private mapApp(
    r: Row & {
      id: string;
      opportunity_id: string | null;
      title: string | null;
      organization: string | null;
      url: string | null;
      deadline_at: Date | null;
      status: ApplicationStatus;
      applied_at: Date | string | null;
      exam_at: Date | null;
      interview_at: Date | null;
      follow_up_at: Date | null;
      payment_status: string | null;
      amount_paid: string | number | null;
      notes: string | null;
      updated_at: Date;
      created_at: Date;
    },
  ): ApplicationRow {
    return {
      id: String(r.id),
      opportunity_id: r.opportunity_id === null ? null : String(r.opportunity_id),
      title: r.title ?? '',
      organization: r.organization,
      url: r.url,
      deadline_at: iso(r.deadline_at),
      status: r.status,
      applied_at: dateOnly(r.applied_at),
      exam_at: iso(r.exam_at),
      interview_at: iso(r.interview_at),
      follow_up_at: iso(r.follow_up_at),
      payment_status: r.payment_status,
      amount_paid: r.amount_paid === null ? null : Number(r.amount_paid),
      notes: r.notes,
      updated_at: r.updated_at.toISOString(),
      created_at: r.created_at.toISOString(),
    };
  }

  private static readonly APP_SELECT = `
    SELECT id, opportunity_id,
           COALESCE(snapshot_title, manual_title) AS title,
           COALESCE(snapshot_organization, manual_organization) AS organization,
           COALESCE(snapshot_url, manual_url) AS url,
           COALESCE(snapshot_deadline_at, manual_deadline_at) AS deadline_at,
           status, applied_at, exam_at, interview_at, follow_up_at, payment_status, amount_paid, notes,
           updated_at, created_at
    FROM application_records`;

  async listApplications(userId: string, status?: string): Promise<ApplicationRow[]> {
    const rows = await this.db.query<Row & Parameters<MeRepo['mapApp']>[0]>(
      `${MeRepo.APP_SELECT} WHERE user_id = :u AND archived_at IS NULL ${status ? 'AND status = :s' : ''}
       ORDER BY (COALESCE(snapshot_deadline_at, manual_deadline_at) IS NULL),
                COALESCE(snapshot_deadline_at, manual_deadline_at), id`,
      { u: userId, s: status },
    );
    return rows.map((r) => this.mapApp(r));
  }

  async getApplication(userId: string, id: string) {
    const rows = await this.db.query<Row & Parameters<MeRepo['mapApp']>[0]>(
      `${MeRepo.APP_SELECT} WHERE id = :id AND user_id = :u`,
      { id, u: userId },
    );
    if (!rows[0]) return null;
    const history = await this.db.query<
      Row & { from_status: string | null; to_status: string; note: string | null; created_at: Date }
    >(
      'SELECT from_status, to_status, note, created_at FROM application_status_history WHERE application_id = :id ORDER BY created_at, id',
      { id },
    );
    const checklist = await this.db.query<
      Row & { id: string; label: string; is_done: number; origin: string }
    >(
      'SELECT id, label, is_done, origin FROM application_checklist_items WHERE application_id = :id ORDER BY sort_order, id',
      { id },
    );
    return {
      ...this.mapApp(rows[0]),
      history: history.map((h) => ({
        from_status: h.from_status,
        to_status: h.to_status,
        note: h.note,
        at: h.created_at.toISOString(),
      })),
      checklist: checklist.map((c) => ({
        id: String(c.id),
        label: c.label,
        done: Number(c.is_done) === 1,
        origin: c.origin,
      })),
    };
  }

  /** Creates a record from a published opportunity (snapshot) or manually. Null = already tracked. */
  async createApplication(
    userId: string,
    input:
      | { opportunityId: string }
      | { title: string; organization?: string; url?: string; deadlineAt?: Date },
  ): Promise<{ id: string } | 'exists' | 'not_found'> {
    return this.db.transaction(async (tx) => {
      let params: Record<string, unknown>;
      let checklistLabels: string[] = [];
      if ('opportunityId' in input) {
        const rows = await tx.query<
          Row & {
            title: string;
            org_en: string | null;
            org_bn: string | null;
            deadline_at: Date | null;
            official_url: string | null;
            application_url: string | null;
            required_documents: unknown;
          }
        >(
          `SELECT o.title, org.name_en AS org_en, org.name_bn AS org_bn, o.deadline_at, ci.official_url,
                  o.application_url, o.required_documents
           FROM opportunities o JOIN organizations org ON org.id = o.organization_id
             JOIN circulars ci ON ci.id = o.circular_id
           WHERE o.id = :id AND o.publication_status = 'published'`,
          { id: input.opportunityId },
        );
        const o = rows[0];
        if (!o) return 'not_found' as const;
        const dup = await tx.query<Row & { id: string }>(
          'SELECT id FROM application_records WHERE user_id = :u AND opportunity_id = :o',
          { u: userId, o: input.opportunityId },
        );
        if (dup[0]) return 'exists' as const;
        params = {
          u: userId,
          opp: input.opportunityId,
          mt: null,
          mo: null,
          mu: null,
          md: null,
          st: o.title,
          so: o.org_en ?? o.org_bn,
          su: o.application_url ?? o.official_url,
          sd: o.deadline_at,
        };
        const docs =
          typeof o.required_documents === 'string'
            ? JSON.parse(o.required_documents)
            : o.required_documents;
        if (Array.isArray(docs)) {
          checklistLabels = docs
            .map((d: { label?: unknown }) => (typeof d?.label === 'string' ? d.label : ''))
            .filter(Boolean)
            .slice(0, 30);
        }
      } else {
        params = {
          u: userId,
          opp: null,
          mt: input.title,
          mo: input.organization ?? null,
          mu: input.url ?? null,
          md: input.deadlineAt ?? null,
          st: null,
          so: null,
          su: null,
          sd: null,
        };
      }
      const res = await tx.execute(
        `INSERT INTO application_records (user_id, opportunity_id, manual_title, manual_organization, manual_url,
           manual_deadline_at, snapshot_title, snapshot_organization, snapshot_url, snapshot_deadline_at, status)
         VALUES (:u, :opp, :mt, :mo, :mu, :md, :st, :so, :su, :sd, 'interested')`,
        params,
      );
      const id = String(res.insertId);
      await tx.execute(
        `INSERT INTO application_status_history (application_id, from_status, to_status) VALUES (:id, NULL, 'interested')`,
        { id },
      );
      let order = 0;
      for (const label of checklistLabels) {
        await tx.execute(
          `INSERT INTO application_checklist_items (application_id, label, origin, sort_order) VALUES (:id, :l, 'circular', :o)`,
          { id, l: label.slice(0, 300), o: order++ },
        );
      }
      return { id };
    });
  }

  async updateApplication(
    userId: string,
    id: string,
    patch: {
      applied_at?: string | null;
      exam_at?: Date | null;
      interview_at?: Date | null;
      follow_up_at?: Date | null;
      payment_status?: string | null;
      amount_paid?: number | null;
      notes?: string | null;
    },
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id, u: userId };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = :${k}`);
      params[k] = v;
    }
    if (sets.length === 0) return (await this.getApplication(userId, id)) !== null;
    const res = await this.db.execute(
      `UPDATE application_records SET ${sets.join(', ')} WHERE id = :id AND user_id = :u`,
      params,
    );
    return res.affectedRows > 0;
  }

  async setStatus(
    userId: string,
    id: string,
    to: ApplicationStatus,
    note?: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<Row & { status: string }>(
        'SELECT status FROM application_records WHERE id = :id AND user_id = :u FOR UPDATE',
        { id, u: userId },
      );
      if (!rows[0]) return false;
      await tx.execute('UPDATE application_records SET status = :to WHERE id = :id', { id, to });
      await tx.execute(
        `INSERT INTO application_status_history (application_id, from_status, to_status, note) VALUES (:id, :from, :to, :note)`,
        { id, from: rows[0].status, to, note: note ?? null },
      );
      return true;
    });
  }

  async deleteApplication(userId: string, id: string): Promise<boolean> {
    const res = await this.db.execute(
      'DELETE FROM application_records WHERE id = :id AND user_id = :u',
      {
        id,
        u: userId,
      },
    );
    return res.affectedRows > 0;
  }

  async addChecklistItem(userId: string, appId: string, label: string): Promise<string | null> {
    const [own] = await this.db.query<Row & { id: string }>(
      'SELECT id FROM application_records WHERE id = :id AND user_id = :u',
      { id: appId, u: userId },
    );
    if (!own) return null;
    const [m] = await this.db.query<Row & { n: number | null }>(
      'SELECT MAX(sort_order) AS n FROM application_checklist_items WHERE application_id = :id',
      { id: appId },
    );
    const res = await this.db.execute(
      `INSERT INTO application_checklist_items (application_id, label, origin, sort_order) VALUES (:id, :l, 'user', :o)`,
      { id: appId, l: label, o: (m?.n ?? -1) + 1 },
    );
    return String(res.insertId);
  }

  async updateChecklistItem(
    userId: string,
    appId: string,
    itemId: string,
    patch: { done?: boolean; label?: string },
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: Record<string, unknown> = { item: itemId, app: appId, u: userId };
    if (patch.done !== undefined) {
      sets.push('i.is_done = :done');
      params.done = patch.done ? 1 : 0;
    }
    if (patch.label !== undefined) {
      sets.push('i.label = :label');
      params.label = patch.label;
    }
    if (sets.length === 0) return true;
    const res = await this.db.execute(
      `UPDATE application_checklist_items i JOIN application_records a ON a.id = i.application_id
       SET ${sets.join(', ')} WHERE i.id = :item AND i.application_id = :app AND a.user_id = :u`,
      params,
    );
    return res.affectedRows > 0;
  }

  async deleteChecklistItem(userId: string, appId: string, itemId: string): Promise<boolean> {
    const res = await this.db.execute(
      `DELETE i FROM application_checklist_items i JOIN application_records a ON a.id = i.application_id
       WHERE i.id = :item AND i.application_id = :app AND a.user_id = :u`,
      { item: itemId, app: appId, u: userId },
    );
    return res.affectedRows > 0;
  }

  async applicationStats(userId: string) {
    const rows = await this.db.query<Row & { status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM application_records WHERE user_id = :u AND archived_at IS NULL GROUP BY status',
      { u: userId },
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }
}

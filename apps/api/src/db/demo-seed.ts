import { slugify } from '@c2a/normalize';
import type { Db, Row } from './pool';
import { OpportunityRepo } from '../modules/opportunities/repo';

/**
 * Reference data (real) and DEMO opportunities (fictional, clearly labelled).
 *
 * Demo rows use made-up organisations and titles marked "[Sample]" / "[নমুনা]" so a visitor can never mistake them
 * for real circulars (plan principle: no invented facts). They exist so staging shows the full browse, search,
 * detail and eligibility flow. The CLI refuses to seed them unless ALLOW_DEMO_SEED=true, and the production
 * configuration must never set it.
 */

const CATEGORIES = [
  { slug: 'jobs', kind: 'job', en: 'Jobs', bn: 'চাকরি', order: 1 },
  { slug: 'internships', kind: 'internship', en: 'Internships', bn: 'ইন্টার্নশিপ', order: 2 },
  { slug: 'scholarships', kind: 'scholarship', en: 'Scholarships', bn: 'বৃত্তি', order: 3 },
] as const;

const LOCATIONS = [
  { slug: 'bd', type: 'country', en: 'Bangladesh', bn: 'বাংলাদেশ' },
  { slug: 'dhaka', type: 'division', en: 'Dhaka', bn: 'ঢাকা' },
  { slug: 'chattogram', type: 'division', en: 'Chattogram', bn: 'চট্টগ্রাম' },
  { slug: 'rajshahi', type: 'division', en: 'Rajshahi', bn: 'রাজশাহী' },
  { slug: 'khulna', type: 'division', en: 'Khulna', bn: 'খুলনা' },
  { slug: 'sylhet', type: 'division', en: 'Sylhet', bn: 'সিলেট' },
  { slug: 'barishal', type: 'division', en: 'Barishal', bn: 'বরিশাল' },
  { slug: 'rangpur', type: 'division', en: 'Rangpur', bn: 'রংপুর' },
  { slug: 'mymensingh', type: 'division', en: 'Mymensingh', bn: 'ময়মনসিংহ' },
] as const;

interface DemoOpportunity {
  key: string;
  category: 'jobs' | 'internships' | 'scholarships';
  org: 'a' | 'b' | 'c';
  titleBn: string;
  titleEn: string;
  position?: string;
  summaryBn: string;
  summaryEn: string;
  location: string;
  daysToDeadline: number;
  vacancies?: number;
  /** sample link on the reserved example.org domain, so no real site is implied */
  applyUrl?: string;
  applyMode?: 'external' | 'site' | 'both';
  howToApply?: string;
  reqs: Array<{
    rule_type: string;
    necessity: 'mandatory' | 'preferred';
    params: Record<string, unknown>;
    text: string;
  }>;
}

const DEMO_ORGS = {
  a: {
    slug: 'demo-organisation-a',
    en: 'Demo Organisation A (sample data)',
    bn: 'ডেমো প্রতিষ্ঠান ক (নমুনা তথ্য)',
    type: 'government',
  },
  b: {
    slug: 'demo-university-b',
    en: 'Demo University B (sample data)',
    bn: 'ডেমো বিশ্ববিদ্যালয় খ (নমুনা তথ্য)',
    type: 'university',
  },
  c: {
    slug: 'demo-foundation-c',
    en: 'Demo Foundation C (sample data)',
    bn: 'ডেমো ফাউন্ডেশন গ (নমুনা তথ্য)',
    type: 'ngo',
  },
} as const;

const NOTE_BN = 'এটি নমুনা তথ্য, আসল সার্কুলার নয়।';
const NOTE_EN = 'This is sample data, not a real circular.';

const DEMO: DemoOpportunity[] = [
  {
    key: 'assistant-programmer',
    category: 'jobs',
    org: 'a',
    titleBn: '[নমুনা] সহকারী প্রোগ্রামার',
    titleEn: '[Sample] Assistant Programmer',
    position: 'Assistant Programmer',
    summaryBn: `সহকারী প্রোগ্রামার পদে নিয়োগ। ${NOTE_BN}`,
    summaryEn: `Recruitment for Assistant Programmer. ${NOTE_EN}`,
    location: 'dhaka',
    daysToDeadline: 12,
    applyMode: 'both',
    applyUrl: 'https://example.org/sample-apply/assistant-programmer',
    howToApply:
      'অনলাইনে আবেদন ফরম পূরণ করে নির্ধারিত তারিখের মধ্যে জমা দিন। (নমুনা তথ্য) / Fill in the online application form and submit it before the deadline. (Sample data)',
    vacancies: 5,
    reqs: [
      {
        rule_type: 'age',
        necessity: 'mandatory',
        params: { max: 30, as_of: '2027-01-01' },
        text: '১ জানুয়ারি ২০২৭ তারিখে বয়স সর্বোচ্চ ৩০ বছর (নমুনা) / Age at most 30 years on 1 January 2027 (sample)',
      },
      {
        rule_type: 'education_level',
        necessity: 'mandatory',
        params: { min_level: 'bachelor' },
        text: 'স্নাতক বা সমমান ডিগ্রি (নমুনা) / Bachelor degree or equivalent (sample)',
      },
      {
        rule_type: 'result',
        necessity: 'mandatory',
        params: { scale: 'gpa4', min: 3.0 },
        text: 'সিজিপিএ ৪.০০ এর মধ্যে কমপক্ষে ৩.০০ (নমুনা) / CGPA at least 3.00 out of 4.00 (sample)',
      },
    ],
  },
  {
    key: 'office-assistant',
    category: 'jobs',
    org: 'a',
    titleBn: '[নমুনা] অফিস সহায়ক',
    titleEn: '[Sample] Office Assistant',
    position: 'Office Assistant',
    summaryBn: `অফিস সহায়ক পদে নিয়োগ। ${NOTE_BN}`,
    summaryEn: `Recruitment for Office Assistant. ${NOTE_EN}`,
    location: 'chattogram',
    daysToDeadline: 6,
    applyMode: 'both',
    applyUrl: 'https://example.org/sample-apply/office-assistant',
    howToApply:
      'অনলাইনে আবেদন ফরম পূরণ করে নির্ধারিত তারিখের মধ্যে জমা দিন। (নমুনা তথ্য) / Fill in the online application form and submit it before the deadline. (Sample data)',
    vacancies: 12,
    reqs: [
      {
        rule_type: 'age',
        necessity: 'mandatory',
        params: { min: 18, max: 32, as_of: '2027-01-01' },
        text: '১ জানুয়ারি ২০২৭ তারিখে বয়স ১৮ থেকে ৩২ বছর (নমুনা) / Age 18 to 32 years on 1 January 2027 (sample)',
      },
      {
        rule_type: 'education_level',
        necessity: 'mandatory',
        params: { min_level: 'hsc' },
        text: 'এইচএসসি বা সমমান (নমুনা) / HSC or equivalent (sample)',
      },
    ],
  },
  {
    key: 'data-entry-operator',
    category: 'jobs',
    org: 'c',
    titleBn: '[নমুনা] ডেটা এন্ট্রি অপারেটর',
    titleEn: '[Sample] Data Entry Operator',
    position: 'Data Entry Operator',
    summaryBn: `ডেটা এন্ট্রি অপারেটর পদে চুক্তিভিত্তিক নিয়োগ। ${NOTE_BN}`,
    summaryEn: `Contract recruitment for Data Entry Operator. ${NOTE_EN}`,
    location: 'sylhet',
    daysToDeadline: 25,
    applyMode: 'site',
    vacancies: 3,
    reqs: [
      {
        rule_type: 'education_level',
        necessity: 'mandatory',
        params: { min_level: 'hsc' },
        text: 'এইচএসসি বা সমমান (নমুনা) / HSC or equivalent (sample)',
      },
      {
        rule_type: 'experience_years',
        necessity: 'preferred',
        params: { min: 1 },
        text: 'এক বছরের অভিজ্ঞতা অগ্রাধিকার (নমুনা) / One year of experience preferred (sample)',
      },
    ],
  },
  {
    key: 'software-internship',
    category: 'internships',
    org: 'a',
    titleBn: '[নমুনা] সফটওয়্যার ইন্টার্নশিপ',
    titleEn: '[Sample] Software Internship',
    position: 'Software Intern',
    summaryBn: `তিন মাসের সফটওয়্যার ইন্টার্নশিপ। ${NOTE_BN}`,
    summaryEn: `Three-month software internship. ${NOTE_EN}`,
    location: 'dhaka',
    daysToDeadline: 18,
    applyMode: 'both',
    applyUrl: 'https://example.org/sample-apply/software-internship',
    howToApply:
      'অনলাইনে আবেদন ফরম পূরণ করে নির্ধারিত তারিখের মধ্যে জমা দিন। (নমুনা তথ্য) / Fill in the online application form and submit it before the deadline. (Sample data)',
    vacancies: 10,
    reqs: [
      {
        rule_type: 'education_level',
        necessity: 'mandatory',
        params: { min_level: 'bachelor' },
        text: 'স্নাতকের শিক্ষার্থী বা স্নাতক উত্তীর্ণ (নমুনা) / Bachelor student or graduate (sample)',
      },
    ],
  },
  {
    key: 'masters-scholarship',
    category: 'scholarships',
    org: 'b',
    titleBn: '[নমুনা] মাস্টার্স বৃত্তি',
    titleEn: '[Sample] Masters Scholarship',
    summaryBn: `মেধাবী শিক্ষার্থীদের জন্য মাস্টার্স বৃত্তি। ${NOTE_BN}`,
    summaryEn: `Masters scholarship for high-achieving students. ${NOTE_EN}`,
    location: 'rajshahi',
    daysToDeadline: 40,
    applyUrl: 'https://example.org/sample-apply/masters-scholarship',
    howToApply:
      'অনলাইনে আবেদন ফরম পূরণ করে নির্ধারিত তারিখের মধ্যে জমা দিন। (নমুনা তথ্য) / Fill in the online application form and submit it before the deadline. (Sample data)',
    reqs: [
      {
        rule_type: 'education_level',
        necessity: 'mandatory',
        params: { min_level: 'bachelor' },
        text: 'স্নাতক ডিগ্রি (নমুনা) / Bachelor degree (sample)',
      },
      {
        rule_type: 'result',
        necessity: 'mandatory',
        params: { scale: 'gpa4', min: 3.5 },
        text: 'সিজিপিএ ৪.০০ এর মধ্যে কমপক্ষে ৩.৫০ (নমুনা) / CGPA at least 3.50 out of 4.00 (sample)',
      },
    ],
  },
  {
    key: 'hsc-merit-stipend',
    category: 'scholarships',
    org: 'c',
    titleBn: '[নমুনা] এইচএসসি মেধা উপবৃত্তি',
    titleEn: '[Sample] HSC Merit Stipend',
    summaryBn: `এইচএসসি উত্তীর্ণ মেধাবী শিক্ষার্থীদের জন্য উপবৃত্তি। ${NOTE_BN}`,
    summaryEn: `Stipend for high-achieving HSC graduates. ${NOTE_EN}`,
    location: 'khulna',
    daysToDeadline: 30,
    howToApply:
      'আবেদনের নিয়ম অফিসিয়াল বিজ্ঞপ্তিতে দেওয়া আছে। (নমুনা তথ্য) / The application steps are in the official notice. (Sample data)',
    reqs: [
      {
        rule_type: 'education_level',
        necessity: 'mandatory',
        params: { min_level: 'hsc' },
        text: 'এইচএসসি বা সমমান (নমুনা) / HSC or equivalent (sample)',
      },
    ],
  },
];

export interface SeedResult {
  categories: number;
  locations: number;
  demoOpportunities: number;
}

async function idOf(db: Db, table: string, slug: string): Promise<string | null> {
  const rows = await db.query<Row & { id: string }>(`SELECT id FROM ${table} WHERE slug = :s`, {
    s: slug,
  });
  return rows[0] ? String(rows[0].id) : null;
}

/** Real reference data. Safe in every environment; idempotent. */
export async function seedReference(db: Db): Promise<{ categories: number; locations: number }> {
  for (const c of CATEGORIES) {
    await db.execute(
      `INSERT INTO opportunity_categories (kind, slug, name_en, name_bn, sort_order)
       VALUES (:k, :s, :en, :bn, :o)
       ON DUPLICATE KEY UPDATE name_en = VALUES(name_en), name_bn = VALUES(name_bn), sort_order = VALUES(sort_order)`,
      { k: c.kind, s: c.slug, en: c.en, bn: c.bn, o: c.order },
    );
  }
  const country = (loc: (typeof LOCATIONS)[number]) => loc.type === 'country';
  for (const l of LOCATIONS.filter(country)) {
    await db.execute(
      `INSERT INTO locations (type, country_code, name_en, name_bn, slug) VALUES (:t, 'BD', :en, :bn, :s)
       ON DUPLICATE KEY UPDATE name_en = VALUES(name_en), name_bn = VALUES(name_bn)`,
      { t: l.type, en: l.en, bn: l.bn, s: l.slug },
    );
  }
  const bdId = await idOf(db, 'locations', 'bd');
  for (const l of LOCATIONS.filter((x) => !country(x))) {
    await db.execute(
      `INSERT INTO locations (parent_id, type, country_code, name_en, name_bn, slug) VALUES (:p, :t, 'BD', :en, :bn, :s)
       ON DUPLICATE KEY UPDATE name_en = VALUES(name_en), name_bn = VALUES(name_bn)`,
      { p: bdId, t: l.type, en: l.en, bn: l.bn, s: l.slug },
    );
  }
  return { categories: CATEGORIES.length, locations: LOCATIONS.length };
}

/** Fictional, labelled demo opportunities with deadlines relative to `now`. Idempotent by slug. */
export async function seedDemo(db: Db, now: Date): Promise<number> {
  const repo = new OpportunityRepo(db);
  await db.execute(
    `INSERT INTO opportunity_sources (name, type, access_status, ingestion_method)
     SELECT 'Demo data (fictional, not real circulars)', 'editor_manual', 'manual_only', 'manual'
     WHERE NOT EXISTS (SELECT 1 FROM opportunity_sources WHERE name = 'Demo data (fictional, not real circulars)')`,
  );
  const [src] = await db.query<Row & { id: string }>(
    `SELECT id FROM opportunity_sources WHERE name = 'Demo data (fictional, not real circulars)'`,
  );
  const sourceId = String(src!.id);
  const orgIds: Record<string, string> = {};
  for (const [k, o] of Object.entries(DEMO_ORGS)) {
    await db.execute(
      `INSERT INTO organizations (slug, name_en, name_bn, name_normalized, type, verification_status)
       VALUES (:s, :en, :bn, :n, :t, 'unverified')
       ON DUPLICATE KEY UPDATE name_en = VALUES(name_en), name_bn = VALUES(name_bn)`,
      { s: o.slug, en: o.en, bn: o.bn, n: slugify(o.en), t: o.type },
    );
    orgIds[k] = (await idOf(db, 'organizations', o.slug))!;
  }
  let created = 0;
  for (const d of DEMO) {
    const slug = `demo-${d.key}`;
    const existing = await idOf(db, 'opportunities', slug);
    if (existing) {
      // refresh the bilingual requirement text on rows created by an earlier version of this seed
      const rows = await db.query<Row & { id: string }>(
        'SELECT id FROM opportunity_requirements WHERE opportunity_id = :o ORDER BY id',
        { o: existing },
      );
      await db.execute(
        'UPDATE opportunities SET application_url = :au, apply_mode = :mode, how_to_apply = :how WHERE id = :id',
        {
          au: d.applyUrl ?? null,
          mode: d.applyMode ?? 'external',
          how: d.howToApply ?? null,
          id: existing,
        },
      );
      if (rows.length === d.reqs.length) {
        for (const [i, r] of d.reqs.entries()) {
          await db.execute(
            'UPDATE opportunity_requirements SET source_text = :txt WHERE id = :id AND source_text <> :txt',
            { txt: r.text, id: rows[i]!.id },
          );
        }
      }
      continue;
    }
    const categoryId = (await idOf(db, 'opportunity_categories', d.category))!;
    const locationId = await idOf(db, 'locations', d.location);
    await db.transaction(async (tx) => {
      const circ = await tx.execute(
        `INSERT INTO circulars (organization_id, title, language, primary_source_id, verification_state, created_by)
         VALUES (:org, :t, 'bn', :src, 'source_attributed', 0)`,
        { org: orgIds[d.org], t: d.titleBn, src: sourceId },
      );
      const deadline = new Date(now.getTime() + d.daysToDeadline * 86_400_000);
      deadline.setUTCHours(17, 59, 59, 0); // 23:59:59 Asia/Dhaka
      const opp = await tx.execute(
        `INSERT INTO opportunities (circular_id, organization_id, category_id, slug, title, title_alt, position_title,
           summary_bn, summary_en, vacancies, application_url, apply_mode, how_to_apply, deadline_at, deadline_precision, publication_status, lifecycle_status, published_at)
         VALUES (:c, :org, :cat, :slug, :t, :ta, :pos, :sbn, :sen, :vac, :au, :mode, :how, :dl, 'date', 'published', 'open', :now)`,
        {
          c: String(circ.insertId),
          org: orgIds[d.org],
          cat: categoryId,
          slug,
          t: d.titleBn,
          ta: d.titleEn,
          pos: d.position ?? null,
          sbn: d.summaryBn,
          sen: d.summaryEn,
          vac: d.vacancies ?? null,
          au: d.applyUrl ?? null,
          mode: d.applyMode ?? 'external',
          how: d.howToApply ?? null,
          dl: deadline,
          now,
        },
      );
      const oppId = String(opp.insertId);
      if (locationId) {
        await tx.execute(
          'INSERT INTO opportunity_locations (opportunity_id, location_id) VALUES (:o, :l)',
          {
            o: oppId,
            l: locationId,
          },
        );
      }
      for (const r of d.reqs) {
        await tx.execute(
          `INSERT INTO opportunity_requirements (opportunity_id, rule_type, necessity, params, source_text, machine_evaluable, verification_state)
           VALUES (:o, :rt, :n, :p, :txt, 1, 'verified')`,
          { o: oppId, rt: r.rule_type, n: r.necessity, p: JSON.stringify(r.params), txt: r.text },
        );
      }
    });
    const id = await idOf(db, 'opportunities', slug);
    if (id) await repo.reindex(id);
    created++;
  }
  return created;
}

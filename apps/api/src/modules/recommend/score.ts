/**
 * Recommendation scoring (plan v1.3 section A). A transparent weighted score: every suggestion carries the
 * reasons that raised it. Pure functions, no clock and no database, so every rule is unit tested.
 */

export type InteractionKind = 'view' | 'search' | 'listing_click' | 'save' | 'track' | 'apply';

export const KIND_WEIGHT: Record<InteractionKind, number> = {
  view: 1,
  search: 1,
  listing_click: 1,
  save: 3,
  track: 4,
  apply: 5,
};

export const HALF_LIFE_DAYS = 21;
export const WINDOW_DAYS = 90;
export const NOTIFY_THRESHOLD = 4.5;

export interface InteractionRow {
  kind: InteractionKind;
  category_slug: string | null;
  location_slug: string | null;
  term: string | null;
  at: Date;
}

export interface Preferences {
  categories: string[];
  keywords: string[];
  location_slugs: string[];
  alerts_enabled: boolean;
  personalize: boolean;
}

export const EMPTY_PREFERENCES: Preferences = {
  categories: [],
  keywords: [],
  location_slugs: [],
  alerts_enabled: true,
  personalize: true,
};

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'sample',
  'job',
  'jobs',
  'post',
  'posts',
  'circular',
  'notice',
  'নমুনা',
  'এবং',
  'জন্য',
  'পদে',
  'নিয়োগ',
  'বিজ্ঞপ্তি',
]);

/** Lower-case words of at least three characters (Latin or Bengali letters), without filler words. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    // marks (\p{M}) belong to a word: Bengali vowel signs and the virama are marks, not letters
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)];
}

function decay(ageDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
}

/** What a person's activity says about them: weights by category, place and word, decayed by age. */
export interface Affinity {
  category: Map<string, number>;
  location: Map<string, number>;
  words: Map<string, number>;
  /** 0..1, how much activity there is (saturates at about ten saves' worth) */
  strength: number;
}

export function buildAffinity(events: InteractionRow[], now: Date): Affinity {
  const category = new Map<string, number>();
  const location = new Map<string, number>();
  const words = new Map<string, number>();
  let total = 0;
  for (const e of events) {
    const ageDays = (now.getTime() - e.at.getTime()) / 86_400_000;
    if (ageDays > WINDOW_DAYS) continue;
    const w = KIND_WEIGHT[e.kind] * decay(ageDays);
    total += w;
    if (e.category_slug) category.set(e.category_slug, (category.get(e.category_slug) ?? 0) + w);
    if (e.location_slug) location.set(e.location_slug, (location.get(e.location_slug) ?? 0) + w);
    for (const t of tokenize(e.term)) words.set(t, (words.get(t) ?? 0) + w);
  }
  const norm = (m: Map<string, number>) => {
    const max = Math.max(0, ...m.values());
    if (max > 0) for (const [k, v] of m) m.set(k, v / max);
  };
  norm(category);
  norm(location);
  norm(words);
  return { category, location, words, strength: Math.min(1, total / 30) };
}

export type ReasonCode =
  | 'category_interest'
  | 'category_activity'
  | 'keyword'
  | 'location'
  | 'eligible'
  | 'closing_soon'
  | 'new';

export interface Reason {
  code: ReasonCode;
  value?: string;
}

export interface Candidate {
  id: string;
  title: string;
  title_alt?: string | null;
  summary?: string | null;
  category_slug: string;
  location_slug: string | null;
  deadline_at: Date | null;
  published_at: Date | null;
  eligibility:
    'eligible' | 'not_eligible' | 'needs_verification' | 'insufficient_information' | null;
}

export interface Scored {
  score: number;
  reasons: Reason[];
}

const cap = (n: number, max: number) => Math.min(max, n);

export function scoreCandidate(
  c: Candidate,
  prefs: Preferences,
  affinity: Affinity | null,
  now: Date,
): Scored {
  const reasons: Reason[] = [];
  let score = 0;

  const catActivity = affinity?.category.get(c.category_slug) ?? 0;
  if (catActivity > 0) {
    score += 4 * catActivity * Math.max(0.35, affinity?.strength ?? 0);
    if (catActivity >= 0.4) reasons.push({ code: 'category_activity', value: c.category_slug });
  }
  if (prefs.categories.includes(c.category_slug)) {
    score += 3;
    reasons.push({ code: 'category_interest', value: c.category_slug });
  }

  if (c.location_slug) {
    const locActivity = affinity?.location.get(c.location_slug) ?? 0;
    score += 1.5 * locActivity;
    if (prefs.location_slugs.includes(c.location_slug)) {
      score += 1.5;
      reasons.push({ code: 'location', value: c.location_slug });
    }
  }

  const words = new Set([
    ...tokenize(c.title),
    ...tokenize(c.title_alt ?? null),
    ...tokenize(c.summary ?? null),
  ]);
  const explicit = prefs.keywords.flatMap((k) => tokenize(k)).filter((k) => words.has(k));
  const explicitHits = [...new Set(explicit)];
  if (explicitHits.length > 0) {
    score += cap(1.5 * explicitHits.length, 4);
    reasons.push({ code: 'keyword', value: explicitHits[0]! });
  }
  if (affinity && affinity.words.size > 0) {
    let overlap = 0;
    for (const w of words) overlap += affinity.words.get(w) ?? 0;
    const learned = cap(overlap, 1.5) * 2 * Math.max(0.35, affinity.strength);
    score += learned;
    if (explicitHits.length === 0 && learned >= 0.8) {
      const best = [...words].sort(
        (a, b) => (affinity.words.get(b) ?? 0) - (affinity.words.get(a) ?? 0),
      )[0];
      if (best && (affinity.words.get(best) ?? 0) > 0)
        reasons.push({ code: 'keyword', value: best });
    }
  }

  if (c.eligibility === 'eligible') {
    score += 2.5;
    reasons.push({ code: 'eligible' });
  } else if (c.eligibility === 'not_eligible') {
    score -= 5;
  }

  if (c.deadline_at) {
    const days = (c.deadline_at.getTime() - now.getTime()) / 86_400_000;
    if (days > 0 && days <= 7) {
      score += 0.6;
      reasons.push({ code: 'closing_soon' });
    }
  }
  if (c.published_at) {
    const age = (now.getTime() - c.published_at.getTime()) / 86_400_000;
    if (age >= 0 && age <= 7) {
      score += 0.4;
      reasons.push({ code: 'new' });
    }
  }

  return { score: Math.round(score * 100) / 100, reasons: reasons.slice(0, 4) };
}

/** Highest score first; ties go to the earlier deadline, then the newer item, so the order is stable. */
export function rank<T extends Candidate>(
  items: T[],
  prefs: Preferences,
  affinity: Affinity | null,
  now: Date,
): Array<T & Scored> {
  return items
    .map((c) => ({ ...c, ...scoreCandidate(c, prefs, affinity, now) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.deadline_at?.getTime() ?? Infinity) - (b.deadline_at?.getTime() ?? Infinity) ||
        (b.published_at?.getTime() ?? 0) - (a.published_at?.getTime() ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

export interface WebJobCandidate {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  snippet: string | null;
  tags: string[];
  posted_at: Date | null;
}

/** Web jobs are matched on words only (explicit keywords, interest names and learned words). */
export function scoreWebJob(
  j: WebJobCandidate,
  prefs: Preferences,
  affinity: Affinity | null,
  now: Date,
  interestWords: string[] = [],
): Scored {
  const words = new Set([
    ...tokenize(j.title),
    ...tokenize(j.company),
    ...tokenize(j.snippet),
    ...j.tags.flatMap((t) => tokenize(t)),
  ]);
  const reasons: Reason[] = [];
  let score = 0;
  const explicit = [...new Set(prefs.keywords.flatMap((k) => tokenize(k)))].filter((k) =>
    words.has(k),
  );
  if (explicit.length > 0) {
    score += cap(2 * explicit.length, 5);
    reasons.push({ code: 'keyword', value: explicit[0]! });
  }
  const interest = [...new Set(interestWords)].filter((w) => words.has(w));
  if (interest.length > 0 && explicit.length === 0) {
    score += cap(1.5 * interest.length, 3);
    reasons.push({ code: 'keyword', value: interest[0]! });
  }
  if (affinity) {
    let overlap = 0;
    for (const w of words) overlap += affinity.words.get(w) ?? 0;
    score += cap(overlap, 1.5) * 2 * Math.max(0.35, affinity.strength);
    if (reasons.length === 0 && overlap > 0.4) {
      const best = [...words].sort(
        (a, b) => (affinity.words.get(b) ?? 0) - (affinity.words.get(a) ?? 0),
      )[0];
      if (best) reasons.push({ code: 'keyword', value: best });
    }
  }
  if (j.posted_at) {
    const age = (now.getTime() - j.posted_at.getTime()) / 86_400_000;
    if (age >= 0 && age <= 7) {
      score += 0.4;
      reasons.push({ code: 'new' });
    }
  }
  return { score: Math.round(score * 100) / 100, reasons: reasons.slice(0, 3) };
}

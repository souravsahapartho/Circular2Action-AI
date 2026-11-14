import { describe, expect, it } from 'vitest';
import {
  buildAffinity,
  EMPTY_PREFERENCES,
  NOTIFY_THRESHOLD,
  rank,
  scoreCandidate,
  scoreWebJob,
  tokenize,
  type Candidate,
  type InteractionRow,
  type Preferences,
} from '../src/modules/recommend/score';

const NOW = new Date('2026-11-14T06:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const cand = (over: Partial<Candidate> & { id: string }): Candidate => ({
  title: 'Generic notice',
  category_slug: 'jobs',
  location_slug: 'dhaka',
  deadline_at: inDays(30),
  published_at: daysAgo(30),
  eligibility: null,
  ...over,
});
const prefs = (over: Partial<Preferences> = {}): Preferences => ({ ...EMPTY_PREFERENCES, ...over });
const ev = (over: Partial<InteractionRow> & Pick<InteractionRow, 'kind'>): InteractionRow => ({
  category_slug: null,
  location_slug: null,
  term: null,
  at: daysAgo(1),
  ...over,
});

describe('tokenize', () => {
  it('keeps real words (Latin and Bengali), drops filler, short words and numbers', () => {
    expect(tokenize('[Sample] Assistant Programmer for the 2026 circular')).toEqual([
      'assistant',
      'programmer',
    ]);
    expect(tokenize('সহকারী প্রোগ্রামার নিয়োগ')).toContain('প্রোগ্রামার');
    expect(tokenize(null)).toEqual([]);
  });
});

describe('affinity', () => {
  it('weights saves above views and decays old activity', () => {
    const a = buildAffinity(
      [
        ev({ kind: 'view', category_slug: 'jobs' }),
        ev({ kind: 'save', category_slug: 'scholarships' }),
      ],
      NOW,
    );
    expect(a.category.get('scholarships')!).toBeGreaterThan(a.category.get('jobs')!);
    const old = buildAffinity([ev({ kind: 'save', category_slug: 'jobs', at: daysAgo(63) })], NOW);
    const fresh = buildAffinity([ev({ kind: 'save', category_slug: 'jobs', at: daysAgo(1) })], NOW);
    expect(old.strength).toBeLessThan(fresh.strength);
  });

  it('ignores activity older than the window', () => {
    const a = buildAffinity([ev({ kind: 'apply', category_slug: 'jobs', at: daysAgo(120) })], NOW);
    expect(a.category.size).toBe(0);
    expect(a.strength).toBe(0);
  });
});

describe('scoring', () => {
  it('an explicit interest in a category raises it and says why', () => {
    const s = scoreCandidate(
      cand({ id: '1', category_slug: 'scholarships' }),
      prefs({ categories: ['scholarships'] }),
      null,
      NOW,
    );
    expect(s.score).toBeGreaterThanOrEqual(3);
    expect(s.reasons).toContainEqual({ code: 'category_interest', value: 'scholarships' });
  });

  it('activity in a category lifts that category over another', () => {
    const affinity = buildAffinity(
      [
        ev({ kind: 'save', category_slug: 'internships' }),
        ev({ kind: 'track', category_slug: 'internships' }),
      ],
      NOW,
    );
    const rows = rank(
      [cand({ id: 'j', category_slug: 'jobs' }), cand({ id: 'i', category_slug: 'internships' })],
      prefs(),
      affinity,
      NOW,
    );
    expect(rows[0]!.id).toBe('i');
    expect(rows[0]!.reasons.map((r) => r.code)).toContain('category_activity');
  });

  it('keywords match in the title and the summary', () => {
    const s = scoreCandidate(
      cand({ id: '1', title: 'Assistant Programmer', summary: 'Work with databases' }),
      prefs({ keywords: ['programmer', 'databases'] }),
      null,
      NOW,
    );
    expect(s.score).toBeGreaterThanOrEqual(3);
    expect(s.reasons.find((r) => r.code === 'keyword')).toBeTruthy();
  });

  it('learns words from titles of what the person engaged with', () => {
    const affinity = buildAffinity([ev({ kind: 'save', term: 'assistant programmer dhaka' })], NOW);
    const a = scoreCandidate(cand({ id: 'a', title: 'Senior Programmer' }), prefs(), affinity, NOW);
    const b = scoreCandidate(cand({ id: 'b', title: 'Driver' }), prefs(), affinity, NOW);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('eligibility helps, ineligibility pushes down', () => {
    const base = scoreCandidate(cand({ id: '1' }), prefs(), null, NOW).score;
    expect(
      scoreCandidate(cand({ id: '1', eligibility: 'eligible' }), prefs(), null, NOW).score,
    ).toBeGreaterThan(base);
    expect(
      scoreCandidate(cand({ id: '1', eligibility: 'not_eligible' }), prefs(), null, NOW).score,
    ).toBeLessThan(base);
  });

  it('closing soon and new add a little and are named', () => {
    const s = scoreCandidate(
      cand({ id: '1', deadline_at: inDays(3), published_at: daysAgo(1) }),
      prefs(),
      null,
      NOW,
    );
    expect(s.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['closing_soon', 'new']));
  });

  it('place preference counts', () => {
    const s = scoreCandidate(
      cand({ id: '1', location_slug: 'sylhet' }),
      prefs({ location_slugs: ['sylhet'] }),
      null,
      NOW,
    );
    expect(s.reasons).toContainEqual({ code: 'location', value: 'sylhet' });
  });

  it('cold start falls back to eligible, soonest deadline, newest, then id (stable)', () => {
    const rows = rank(
      [
        cand({ id: 'c', deadline_at: inDays(20) }),
        cand({ id: 'a', deadline_at: inDays(2) }),
        cand({ id: 'b', deadline_at: inDays(2), eligibility: 'eligible' }),
      ],
      prefs(),
      null,
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(
      rank([cand({ id: 'x' }), cand({ id: 'y' })], prefs(), null, NOW).map((r) => r.id),
    ).toEqual(['x', 'y']);
  });

  it('a strong match passes the notification threshold, a weak one does not', () => {
    const strong = scoreCandidate(
      cand({ id: '1', title: 'Software Engineer', category_slug: 'jobs', eligibility: 'eligible' }),
      prefs({ categories: ['jobs'], keywords: ['software'] }),
      null,
      NOW,
    );
    const weak = scoreCandidate(
      cand({ id: '2', title: 'Cook', category_slug: 'scholarships' }),
      prefs({ categories: ['jobs'] }),
      null,
      NOW,
    );
    expect(strong.score).toBeGreaterThanOrEqual(NOTIFY_THRESHOLD);
    expect(weak.score).toBeLessThan(NOTIFY_THRESHOLD);
  });
});

describe('web jobs', () => {
  const job = (title: string, snippet = '') => ({
    id: '1',
    title,
    company: 'Acme',
    location: 'Berlin',
    snippet,
    tags: [],
    posted_at: daysAgo(1),
  });
  it('match on explicit keywords and interest words, and name the keyword', () => {
    const s = scoreWebJob(job('Backend Developer'), prefs({ keywords: ['developer'] }), null, NOW);
    expect(s.reasons[0]).toEqual({ code: 'keyword', value: 'developer' });
    expect(
      scoreWebJob(job('Nurse'), prefs({ keywords: ['developer'] }), null, NOW).reasons.some(
        (r) => r.code === 'keyword',
      ),
    ).toBe(false);
    const viaInterest = scoreWebJob(job('Internship in design'), prefs(), null, NOW, [
      'internship',
    ]);
    expect(viaInterest.reasons[0]).toEqual({ code: 'keyword', value: 'internship' });
  });
});

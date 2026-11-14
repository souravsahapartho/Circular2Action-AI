import { describe, expect, it } from 'vitest';
import {
  applicantCanWithdraw,
  newTrackingCode,
  normalizeTrackingCode,
  SITE_STATUSES,
  staffCanMove,
  TRACKING_CODE,
} from '../src/modules/applications/logic';
import {
  cleanSnippet,
  httpUrlOrNull,
  parseArbeitnow,
  parseGoogle,
  parseRemotive,
} from '../src/modules/listings/sources';

describe('tracking codes', () => {
  it('have the C2A-XXXX-XXXX shape and never use look-alike characters', () => {
    for (let i = 0; i < 500; i++) {
      const c = newTrackingCode();
      expect(c).toMatch(TRACKING_CODE);
      expect(c.slice(4)).not.toMatch(/[01OIL]/);
    }
  });

  it('are different from each other and can be driven by a test source', () => {
    expect(new Set(Array.from({ length: 200 }, () => newTrackingCode())).size).toBe(200);
    expect(newTrackingCode(() => 0)).toBe('C2A-AAAA-AAAA');
  });

  it('normalise what people type', () => {
    expect(normalizeTrackingCode('c2a-abcd-2345')).toBe('C2A-ABCD-2345');
    expect(normalizeTrackingCode(' C2A ABCD 2345 ')).toBe('C2A-ABCD-2345');
    expect(normalizeTrackingCode('abcd2345')).toBe('C2A-ABCD-2345');
    expect(normalizeTrackingCode('C2A-ABCD-234')).toBeNull();
    expect(normalizeTrackingCode('C2A-ABCO-2345')).toBeNull(); // O is not in the alphabet
    expect(normalizeTrackingCode("'; DROP TABLE x;--")).toBeNull();
  });
});

describe('application status rules', () => {
  it('lets staff move forward only, never out of a closed state, never to withdrawn', () => {
    expect(staffCanMove('submitted', 'under_review')).toBe(true);
    expect(staffCanMove('submitted', 'accepted')).toBe(false);
    expect(staffCanMove('shortlisted', 'interview')).toBe(true);
    expect(staffCanMove('interview', 'accepted')).toBe(true);
    for (const closed of ['accepted', 'rejected', 'withdrawn'] as const) {
      for (const to of SITE_STATUSES) expect(staffCanMove(closed, to)).toBe(false);
    }
    for (const from of SITE_STATUSES) expect(staffCanMove(from, 'withdrawn')).toBe(false);
  });

  it('lets the applicant withdraw until the application is closed', () => {
    expect(applicantCanWithdraw('submitted')).toBe(true);
    expect(applicantCanWithdraw('interview')).toBe(true);
    expect(applicantCanWithdraw('accepted')).toBe(false);
    expect(applicantCanWithdraw('withdrawn')).toBe(false);
  });
});

describe('web job connectors (fixtures, no network)', () => {
  it('cleans HTML to a short plain snippet', () => {
    expect(cleanSnippet('<p>Hello <b>world</b> &amp; friends</p><script>alert(1)</script>')).toBe(
      'Hello world & friends',
    );
    expect(cleanSnippet('x'.repeat(900))!.length).toBe(500);
    expect(cleanSnippet('')).toBeNull();
    expect(cleanSnippet(42)).toBeNull();
  });

  it('accepts only http(s) links', () => {
    expect(httpUrlOrNull('https://example.org/a')).toBe('https://example.org/a');
    expect(httpUrlOrNull('javascript:alert(1)')).toBeNull();
    expect(httpUrlOrNull('data:text/html,hi')).toBeNull();
    expect(httpUrlOrNull('not a url')).toBeNull();
  });

  it('parses Arbeitnow and skips bad entries', () => {
    const out = parseArbeitnow({
      data: [
        {
          slug: 'dev-1',
          company_name: 'Acme',
          title: 'Developer',
          description: '<p>Build things</p>',
          remote: true,
          url: 'https://www.arbeitnow.com/jobs/dev-1',
          tags: ['it'],
          location: '',
          created_at: 1760000000,
        },
        { slug: 'bad', title: 'No url' },
        { slug: 'js', title: 'Evil', url: 'javascript:alert(1)' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      external_id: 'dev-1',
      company: 'Acme',
      location: 'Remote',
      snippet: 'Build things',
    });
    expect(out[0]!.posted_at?.getUTCFullYear()).toBe(2025);
    expect(parseArbeitnow(null)).toEqual([]);
  });

  it('parses Remotive and Google results', () => {
    const r = parseRemotive({
      jobs: [
        {
          id: 77,
          url: 'https://remotive.com/job/77',
          title: 'Designer',
          company_name: 'Studio',
          category: 'Design',
          publication_date: '2026-11-01T10:00:00',
          candidate_required_location: 'Worldwide',
          description: '<div>Make it nice</div>',
        },
      ],
    });
    expect(r[0]).toMatchObject({ external_id: '77', location: 'Worldwide', tags: ['Design'] });
    const g = parseGoogle({
      items: [
        {
          title: 'Jobs',
          link: 'https://jobs.example/a',
          snippet: 'Open roles',
          displayLink: 'jobs.example',
        },
      ],
    });
    expect(g[0]).toMatchObject({ company: 'jobs.example', snippet: 'Open roles' });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { AuthRepo } from '../src/modules/auth/repo';
import { CaptureMailer } from '../src/modules/email/mailer';
import { ListingRepo } from '../src/modules/listings/repo';
import { buildConnectors, cleanDescription } from '../src/modules/listings/sources';
import { TestClock } from '../src/platform/clock';
import { loadConfig } from '../src/platform/config';
import { Browser } from './browser';
import { freshDatabase, type TestDb } from './helpers';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_ENV: 'local',
  WEB_ORIGIN: 'http://localhost:3000',
  INTERNAL_HMAC_SECRETS: 's'.repeat(40),
  EMAIL_VERIFICATION_REQUIRED: 'false',
});

describe('web job detail pages', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));
  const calls: string[] = [];

  const fakeFetch = async (url: string): Promise<Response> => {
    calls.push(url);
    if (url.includes('arbeitnow')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              slug: 'dev-1',
              company_name: 'Acme',
              title: 'Backend Developer',
              description:
                '<h3>About the role</h3><p>Build APIs &amp; services.</p><ul><li>Node.js</li><li>SQL</li></ul><script>alert(1)</script>',
              url: 'https://www.arbeitnow.com/jobs/dev-1',
              tags: ['it'],
              location: 'Berlin',
              created_at: 1760000000,
            },
            {
              slug: 'intern-1',
              company_name: 'Beta',
              title: 'Software Engineering Intern',
              description: '<p>Learn on the job.</p>',
              url: 'https://www.arbeitnow.com/jobs/intern-1',
              tags: [],
              location: 'Munich',
              created_at: 1760000100,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url === 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs') {
      return new Response(
        JSON.stringify({
          jobs: [
            {
              id: 4242,
              title: 'Support Engineer',
              absolute_url: 'https://job-boards.greenhouse.io/gitlab/jobs/4242',
              location: { name: 'Remote' },
              updated_at: '2026-11-10T00:00:00Z',
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url === 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/4242') {
      return new Response(
        JSON.stringify({
          content: '&lt;p&gt;Help customers.&lt;/p&gt;&lt;p&gt;Great team.&lt;/p&gt;',
        }),
        { status: 200 },
      );
    }
    return new Response('nope', { status: 404 });
  };

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    const repo = new ListingRepo(t.db, buildConnectors(), clock, fakeFetch);
    app = buildApp({
      config,
      clock,
      auth: { repo: new AuthRepo(t.db), mailer: new CaptureMailer() },
      listings: { repo },
    });
    await repo.refresh('arbeitnow');
    await repo.refresh('greenhouse');
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const listAll = async () =>
    (await new Browser(app).req('GET', '/api/v1/listings?limit=20')).json().data as Array<{
      id: string;
      source: string;
    }>;

  it('stores the full description as clean text and serves it with the apply link', async () => {
    const anon = new Browser(app);
    const job = (await listAll()).find((l) => l.title === 'Backend Developer')!;
    const res = await anon.req('GET', `/api/v1/listings/${job.id}`);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toMatchObject({
      title: 'Backend Developer',
      company: 'Acme',
      url: 'https://www.arbeitnow.com/jobs/dev-1',
      source: 'arbeitnow',
    });
    expect(d).not.toHaveProperty('hidden');
    expect(d.description).toContain('Build APIs & services.');
    expect(d.description).toContain('• Node.js');
    expect(d.description).not.toContain('<');
    expect(d.description).not.toContain('alert(1)');
  });

  it('lists web jobs by kind so they can sit in the matching list', async () => {
    const anon = new Browser(app);
    const interns = (await anon.req('GET', '/api/v1/listings?category=internships')).json()
      .data as Array<{
      title: string;
      category_slug: string;
    }>;
    expect(interns.map((x) => x.title)).toEqual(['Software Engineering Intern']);
    expect(interns[0]!.category_slug).toBe('internships');
    const jobs = (await anon.req('GET', '/api/v1/listings?category=jobs')).json().data as Array<{
      title: string;
    }>;
    expect(jobs.map((x) => x.title)).toContain('Backend Developer');
    expect(jobs.map((x) => x.title)).not.toContain('Software Engineering Intern');
    expect((await anon.req('GET', '/api/v1/listings?category=bogus')).statusCode).toBe(422);
  });

  it('fetches a Greenhouse description once, when the job is first opened', async () => {
    const anon = new Browser(app);
    const job = (await listAll()).find((l) => l.source === 'greenhouse')!;
    const detailUrl = 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/4242';
    expect(calls.filter((c) => c === detailUrl)).toHaveLength(0);
    const first = (await anon.req('GET', `/api/v1/listings/${job.id}`)).json().data;
    expect(first.description).toBe('Help customers.\n\nGreat team.');
    await anon.req('GET', `/api/v1/listings/${job.id}`);
    expect(calls.filter((c) => c === detailUrl)).toHaveLength(1);
  });

  it('hidden or unknown jobs are not found; bad ids are refused', async () => {
    const anon = new Browser(app);
    const job = (await listAll())[0]!;
    await t.db.execute('UPDATE external_listings SET hidden = 1 WHERE id = :id', { id: job.id });
    expect((await anon.req('GET', `/api/v1/listings/${job.id}`)).statusCode).toBe(404);
    expect((await anon.req('GET', '/api/v1/listings/999999999')).statusCode).toBe(404);
    expect((await anon.req('GET', '/api/v1/listings/abc')).statusCode).toBe(404);
    // the fixed route for sources is not shadowed by the id route
    expect((await anon.req('GET', '/api/v1/listings/sources')).statusCode).toBe(200);
  });

  it('cleanDescription keeps paragraphs and bullets, drops markup and caps the length', () => {
    expect(cleanDescription('<p>A</p><p>B &amp; C</p>')).toBe('A\n\nB & C');
    expect(cleanDescription('<ul><li>x</li><li>y</li></ul>')).toBe('• x\n• y');
    expect(cleanDescription('&lt;p&gt;double&lt;/p&gt;')).toBe('double');
    expect(cleanDescription('   ')).toBeNull();
    expect(cleanDescription(42)).toBeNull();
    const long = Array.from({ length: 200 }, (_, i) => `<p>Paragraph number ${i}</p>`).join('');
    const cut = cleanDescription(long, 500)!;
    expect(cut.length).toBeLessThanOrEqual(501);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('web job kinds', () => {
  it('classifies by title first, then tags', async () => {
    const { classifyListing } = await import('../src/modules/listings/sources');
    expect(classifyListing('Software Engineering Intern')).toBe('internships');
    expect(classifyListing('Werkstudent Marketing (m/w/d)')).toBe('internships');
    expect(classifyListing('Graduate Scholarship Programme')).toBe('scholarships');
    expect(classifyListing('PhD Fellowship in Physics')).toBe('scholarships');
    expect(classifyListing('Backend Developer', ['internship'])).toBe('internships');
    expect(classifyListing('Senior Engineer')).toBe('jobs');
    expect(classifyListing('International Sales Manager')).toBe('jobs'); // "intern" inside a word is not an internship
  });
});

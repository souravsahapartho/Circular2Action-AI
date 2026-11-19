import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { AuthRepo } from '../src/modules/auth/repo';
import { CaptureMailer } from '../src/modules/email/mailer';
import { ListingRepo } from '../src/modules/listings/repo';
import { buildConnectors } from '../src/modules/listings/sources';
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

describe('Bangladeshi sites first, a smaller share of foreign jobs', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));
  const googleQueries: string[] = [];

  const fakeFetch = async (url: string): Promise<Response> => {
    if (url.includes('www.googleapis.com/customsearch')) {
      const q = new URL(url).searchParams.get('q') ?? '';
      googleQueries.push(q);
      const items =
        q === 'jobs in Dhaka'
          ? [
              {
                title: 'Accounts Officer',
                link: 'https://www.chakri.com/job/1',
                displayLink: 'chakri.com',
                snippet: 'Dhaka',
              },
              {
                title: 'Sales Executive',
                link: 'https://bikroy.com/en/ad/2',
                displayLink: 'bikroy.com',
                snippet: 'Dhaka',
              },
              {
                title: 'Marketing Intern',
                link: 'https://www.linkedin.com/jobs/view/3',
                displayLink: 'linkedin.com',
                snippet: 'Intern',
              },
              {
                title: 'Driver',
                link: 'https://jagojobs.com/job/4',
                displayLink: 'jagojobs.com',
                snippet: 'Dhaka',
              },
              {
                title: 'Graphic Designer',
                link: 'https://skill.jobs/job/5',
                displayLink: 'skill.jobs',
                snippet: 'Dhaka',
              },
              {
                title: 'IT Support',
                link: 'https://nextjobs.com.bd/job/6',
                displayLink: 'nextjobs.com.bd',
                snippet: 'Dhaka',
              },
            ]
          : q === 'internship Bangladesh'
            ? [
                {
                  title: 'Accounts Officer',
                  link: 'https://www.chakri.com/job/1',
                  displayLink: 'chakri.com',
                  snippet: 'again',
                },
              ]
            : [];
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    if (url.includes('arbeitnow')) {
      return new Response(
        JSON.stringify({
          data: [1, 2, 3, 4].map((n) => ({
            slug: `de-${n}`,
            company_name: `Firma ${n}`,
            title: `Developer ${n}`,
            description: '<p>Text</p>',
            url: `https://www.arbeitnow.com/jobs/de-${n}`,
            tags: [],
            location: 'Berlin',
            created_at: 1760000000 + n,
          })),
        }),
        { status: 200 },
      );
    }
    return new Response('nope', { status: 404 });
  };

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    const repo = new ListingRepo(
      t.db,
      buildConnectors({
        googleKey: 'k'.repeat(12),
        googleCx: 'cx-test',
        googleQuery: 'jobs in Dhaka|internship Bangladesh',
      }),
      clock,
      fakeFetch,
    );
    app = buildApp({
      config,
      clock,
      auth: { repo: new AuthRepo(t.db), mailer: new CaptureMailer() },
      listings: { repo },
    });
    await repo.refresh('arbeitnow');
    await repo.refresh('google');
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  it('searches each phrase once and keeps one copy of a repeated result', async () => {
    expect(googleQueries.sort()).toEqual(['internship Bangladesh', 'jobs in Dhaka']);
    const [n] = await t.db.query<{ n: number } & import('../src/db/pool').Row>(
      "SELECT COUNT(*) AS n FROM external_listings WHERE source = 'google'",
    );
    expect(Number(n!.n)).toBe(6); // the repeated Chakri result is stored once
  });

  it('marks Bangladeshi sites as Bangladeshi and the German feed as foreign', async () => {
    const rows = await t.db.query<{ region: string; n: number } & import('../src/db/pool').Row>(
      'SELECT region, COUNT(*) AS n FROM external_listings GROUP BY region',
    );
    const by = Object.fromEntries(rows.map((r) => [r.region, Number(r.n)]));
    expect(by).toEqual({ bd: 6, intl: 4 });
  });

  it('the public list gives three Bangladeshi to one foreign, Bangladeshi first', async () => {
    const anon = new Browser(app);
    const list = (await anon.req('GET', '/api/v1/listings?limit=8')).json().data as Array<{
      region: string;
      source: string;
    }>;
    expect(list.map((x) => x.region)).toEqual(['bd', 'bd', 'bd', 'intl', 'bd', 'bd', 'bd', 'intl']);
    // page two continues the rhythm with new items (no repeats)
    const p2 = (await anon.req('GET', '/api/v1/listings?limit=8&offset=8')).json().data as Array<{
      id: string;
    }>;
    const first = new Set(
      (
        (await anon.req('GET', '/api/v1/listings?limit=8')).json().data as Array<{ id: string }>
      ).map((x) => x.id),
    );
    expect(p2.every((x) => !first.has(x.id))).toBe(true);
    // filtering by one source keeps that source's own order
    const only = (await anon.req('GET', '/api/v1/listings?source=arbeitnow&limit=10')).json()
      .data as Array<{
      region: string;
    }>;
    expect(only).toHaveLength(4);
    expect(only.every((x) => x.region === 'intl')).toBe(true);
    // Google results can be internships
    const interns = (await anon.req('GET', '/api/v1/listings?category=internships')).json()
      .data as Array<{
      title: string;
    }>;
    expect(interns.map((x) => x.title)).toEqual(['Marketing Intern']);
  });
});

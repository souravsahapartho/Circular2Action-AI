import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { seedDemo, seedReference } from '../src/db/demo-seed';
import { OpportunityRepo } from '../src/modules/opportunities/repo';
import { TestClock } from '../src/platform/clock';
import { loadConfig } from '../src/platform/config';
import { freshDatabase, type TestDb } from './helpers';

const config = loadConfig({
  NODE_ENV: 'test',
  INTERNAL_HMAC_SECRETS: 's'.repeat(40),
});

describe('opportunity browse, detail and search on TiDB', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const clock = new TestClock(new Date('2026-11-13T06:00:00Z'));

  beforeAll(async () => {
    t = await freshDatabase({ migrate: true });
    await seedReference(t.db);
    await seedDemo(t.db, clock.now());
    app = buildApp({ config, clock, opportunities: { repo: new OpportunityRepo(t.db) } });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const get = async (url: string) => app.inject({ method: 'GET', url });

  it('seeding is idempotent', async () => {
    expect(await seedDemo(t.db, clock.now())).toBe(0);
    const again = await seedReference(t.db);
    expect(again.categories).toBe(3);
  });

  it('lists published opportunities soonest deadline first, with Bangla names and counts', async () => {
    const res = await get('/api/v1/opportunities?locale=bn');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.total).toBe(6);
    expect(body.data).toHaveLength(6);
    const deadlines = body.data.map((o: { deadline_at: string }) => o.deadline_at);
    expect([...deadlines].sort()).toEqual(deadlines);
    expect(body.data[0].title).toBe('[নমুনা] অফিস সহায়ক');
    expect(body.data[0]).toMatchObject({
      organization: 'ডেমো প্রতিষ্ঠান ক (নমুনা তথ্য)',
      location: 'চট্টগ্রাম',
      category: 'চাকরি',
      category_slug: 'jobs',
    });
  });

  it('English locale returns English organisation, location and category names', async () => {
    const o = (await get('/api/v1/opportunities?locale=en')).json().data[0];
    expect(o).toMatchObject({
      organization: 'Demo Organisation A (sample data)',
      location: 'Chattogram',
      category: 'Jobs',
    });
  });

  it('filters by category and paginates', async () => {
    const sch = (await get('/api/v1/opportunities?category=scholarships')).json();
    expect(sch.meta.total).toBe(2);
    const page = (await get('/api/v1/opportunities?limit=2&offset=4')).json();
    expect(page.data).toHaveLength(2);
    expect(page.meta).toMatchObject({ total: 6, limit: 2, offset: 4 });
  });

  it('expired opportunities are hidden when time moves past their deadline', async () => {
    clock.advanceMs(8 * 86_400_000); // the 6-day job is now closed
    const body = (await get('/api/v1/opportunities')).json();
    expect(body.meta.total).toBe(5);
    expect(body.data.some((o: { slug: string }) => o.slug === 'demo-office-assistant')).toBe(false);
    clock.advanceMs(-8 * 86_400_000);
  });

  it('unpublished opportunities never appear in list, search or detail', async () => {
    const [row] = await t.db.query<{ id: string }>(
      "SELECT id FROM opportunities WHERE slug = 'demo-data-entry-operator'",
    );
    await t.db.execute("UPDATE opportunities SET publication_status = 'draft' WHERE id = :id", {
      id: row!.id,
    });
    expect((await get('/api/v1/opportunities')).json().meta.total).toBe(5);
    expect((await get(`/api/v1/opportunities/${row!.id}`)).statusCode).toBe(404);
    expect((await get('/api/v1/search?q=Data%20Entry')).json().meta.total).toBe(0);
    await t.db.execute("UPDATE opportunities SET publication_status = 'published' WHERE id = :id", {
      id: row!.id,
    });
  });

  it('detail returns summary, requirements and the demo notice', async () => {
    const list = (await get('/api/v1/opportunities?locale=en')).json().data as Array<{
      id: string;
      slug: string;
    }>;
    const prog = list.find((o) => o.slug === 'demo-assistant-programmer')!;
    const res = await get(`/api/v1/opportunities/${prog.id}?locale=en`);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.title).toBe('[নমুনা] সহকারী প্রোগ্রামার');
    expect(d.summary).toContain('sample data');
    expect(d.vacancies).toBe(5);
    expect(d.verified).toBe(false);
    expect(d.requirements).toHaveLength(3);
    expect(d.requirements[0]).toMatchObject({ verified: true, machine_evaluable: true });
    expect(d.requirements.every((r: { text: string }) => r.text.includes(' / '))).toBe(true);
    expect(typeof d.requirements[0].params).toBe('object');
    expect(d.requirements.map((r: { rule_type: string }) => r.rule_type).sort()).toEqual([
      'age',
      'education_level',
      'result',
    ]);
  });

  it('detail: unknown and malformed ids', async () => {
    expect((await get('/api/v1/opportunities/999')).statusCode).toBe(404);
    expect((await get('/api/v1/opportunities/abc')).statusCode).toBe(422);
  });

  it('search finds Bangla, English and mixed terms, and organisation names', async () => {
    const q = async (s: string) => (await get(`/api/v1/search?q=${encodeURIComponent(s)}`)).json();
    expect((await q('প্রোগ্রামার')).meta.total).toBe(1);
    expect((await q('programmer')).meta.total).toBe(1);
    expect((await q('PROGRAMMER')).meta.total).toBe(1);
    expect((await q('scholarship')).meta.total).toBe(1);
    expect((await q('বৃত্তি')).meta.total).toBe(2);
    expect((await q('demo university')).meta.total).toBe(1);
    expect((await q('zzzz-no-match')).meta.total).toBe(0);
  });

  it('search treats % and _ literally and survives hostile strings', async () => {
    for (const s of ['%', '_', "' OR 1=1 --", '\\', '😀', 'a'.repeat(200)]) {
      const res = await get(`/api/v1/search?q=${encodeURIComponent(s)}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().meta.total).toBe(0);
    }
    expect((await get('/api/v1/search?q=')).statusCode).toBe(422);
    expect((await get(`/api/v1/search?q=${'a'.repeat(201)}`)).statusCode).toBe(422);
  });
});

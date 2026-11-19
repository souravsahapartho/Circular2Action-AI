import { describe, expect, it } from 'vitest';
import { diversify } from '../src/modules/recommend/service';
import {
  parseGreenhouse,
  parseHimalayas,
  parseJobicy,
  parseLever,
  parseRemoteOk,
} from '../src/modules/listings/sources';

const j = (id: number, company: string, source = 's1') => ({ id, company, source });

describe('diversify', () => {
  it('keeps everything and breaks up runs of one company', () => {
    const list = [j(1, 'A'), j(2, 'A'), j(3, 'A'), j(4, 'B'), j(5, 'C'), j(6, 'D')];
    const out = diversify(list);
    expect(out.map((x) => x.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 2; i < out.length; i++) {
      const same =
        out[i]!.company === out[i - 1]!.company && out[i]!.company === out[i - 2]!.company;
      expect(same).toBe(false);
    }
    expect(out[0]!.id).toBe(1);
  });
  it('is stable when nothing repeats', () => {
    const list = [j(1, 'A', 'x'), j(2, 'B', 'y'), j(3, 'C', 'z'), j(4, 'D', 'w')];
    expect(diversify(list).map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });
  it('handles empty and missing companies', () => {
    expect(diversify([])).toEqual([]);
    const out = diversify([
      { company: null, source: 'a' },
      { company: null, source: 'a' },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('new job sources', () => {
  it('parses Jobicy', () => {
    const r = parseJobicy({
      jobs: [
        {
          id: 1,
          url: 'https://jobicy.com/jobs/1',
          jobTitle: 'Dev',
          companyName: 'Acme',
          jobGeo: 'USA',
          jobExcerpt: '<p>Hi &amp; bye</p>',
          jobIndustry: ['Tech'],
          pubDate: '2026-11-01 10:00:00',
        },
        { id: 2, url: 'javascript:alert(1)', jobTitle: 'Bad' },
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.snippet).toBe('Hi & bye');
  });
  it('parses Remote OK and skips the legal notice', () => {
    const r = parseRemoteOk([
      { legal: 'terms' },
      {
        id: '9',
        url: 'https://remoteok.com/x',
        position: 'Eng',
        company: 'Co',
        tags: ['a'],
        date: '2026-11-17T00:00:00+00:00',
      },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.company).toBe('Co');
  });
  it('parses Himalayas', () => {
    const r = parseHimalayas({
      jobs: [
        {
          title: 'T',
          guid: 'https://himalayas.app/j/1',
          applicationLink: 'https://himalayas.app/j/1',
          companyName: 'C',
          locationRestrictions: ['Brazil'],
          categories: ['Dev'],
          pubDate: 1794873629,
        },
      ],
    });
    expect(r[0]!.location).toBe('Brazil');
    expect(r[0]!.posted_at).not.toBeNull();
  });
  it('parses Greenhouse and Lever with the company name and newest first', () => {
    const g = parseGreenhouse('gitlab', 'GitLab', {
      jobs: [
        {
          id: 1,
          title: 'Old',
          absolute_url: 'https://x.test/1',
          location: { name: 'Remote' },
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 2,
          title: 'New',
          absolute_url: 'https://x.test/2',
          updated_at: '2026-06-01T00:00:00Z',
        },
      ],
    });
    expect(g.map((x) => x.title)).toEqual(['New', 'Old']);
    expect(g[0]!.company).toBe('GitLab');
    const l = parseLever('spotify', 'Spotify', [
      {
        id: 'a',
        text: 'Role',
        hostedUrl: 'https://jobs.lever.co/spotify/a',
        categories: { location: 'Stockholm', team: 'Eng' },
        descriptionPlain: 'Text',
        createdAt: 1794873629000,
      },
    ]);
    expect(l[0]!.location).toBe('Stockholm');
    expect(l[0]!.tags).toContain('Eng');
  });
});

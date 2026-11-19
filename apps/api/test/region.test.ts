import { describe, expect, it } from 'vitest';
import { mixRegions } from '../src/modules/listings/repo';
import { classifyListing, regionOf } from '../src/modules/listings/sources';

describe('regionOf', () => {
  it('counts Google results (limited to Bangladesh), known Bangladeshi sites and Bangladeshi places as Bangladeshi', () => {
    expect(regionOf('google', 'https://www.linkedin.com/jobs/view/1', null)).toBe('bd');
    expect(regionOf('lever', 'https://bikroy.com/en/ad/x', null)).toBe('bd');
    expect(regionOf('lever', 'https://www.chakri.com/job/1', null)).toBe('bd');
    expect(regionOf('remoteok', 'https://remoteok.com/x', 'Dhaka, Bangladesh')).toBe('bd');
    expect(regionOf('arbeitnow', 'https://www.arbeitnow.com/x', 'Berlin')).toBe('intl');
    expect(regionOf('greenhouse', 'https://boards.greenhouse.io/x', 'Remote')).toBe('intl');
    // a look-alike host is not a Bangladeshi site
    expect(regionOf('lever', 'https://bikroy.com.evil.example/x', null)).toBe('intl');
    expect(regionOf('lever', 'not a url', null)).toBe('intl');
  });
  it('Google results can be internships or scholarships too', () => {
    expect(classifyListing('Marketing Intern - Dhaka')).toBe('internships');
    expect(classifyListing('Chevening Scholarship for Bangladesh')).toBe('scholarships');
  });
});

describe('mixRegions', () => {
  it('gives three Bangladeshi to one foreign and keeps each side in order', () => {
    const out = mixRegions(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], ['f1', 'f2'], 3);
    expect(out).toEqual(['b1', 'b2', 'b3', 'f1', 'b4', 'b5', 'b6', 'f2']);
  });
  it('falls back to whatever exists', () => {
    expect(mixRegions([], ['f1', 'f2'], 3)).toEqual(['f1', 'f2']);
    expect(mixRegions(['b1', 'b2'], [], 3)).toEqual(['b1', 'b2']);
    expect(mixRegions([], [], 3)).toEqual([]);
  });
});

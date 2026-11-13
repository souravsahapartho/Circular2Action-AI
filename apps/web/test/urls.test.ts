import { describe, expect, it } from 'vitest';
import { callApiForTest } from './helpers-client';
import { safeNext } from '../src/lib/safe-next';
import { idFromSlug, safeHref } from '../src/lib/urls';

describe('safeNext (post-login redirect)', () => {
  it('accepts same-site locale and admin paths', () => {
    expect(safeNext('/bn/app/tracker', '/x')).toBe('/bn/app/tracker');
    expect(safeNext('/en/opportunities/a-1?x=1', '/x')).toBe('/en/opportunities/a-1?x=1');
    expect(safeNext('/admin/opportunities', '/x')).toBe('/admin/opportunities');
  });
  it('rejects open-redirect attempts', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      String.raw`/\evil.example`,
      'javascript:alert(1)',
      '/bn//evil.example',
      '/other',
      '',
      null,
      undefined,
    ]) {
      expect(safeNext(bad as string | null, '/fallback')).toBe('/fallback');
    }
  });
});

describe('safeHref (links from data)', () => {
  it('keeps only http(s) links', () => {
    expect(safeHref('https://example.gov.bd/c/1')).toBe('https://example.gov.bd/c/1');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>',
      'file:///etc/passwd',
      'not a url',
      '',
      null,
      undefined,
    ]) {
      expect(safeHref(bad as string | null)).toBeNull();
    }
  });
});

describe('idFromSlug', () => {
  it('takes the trailing numeric id', () => {
    expect(idFromSlug('assistant-programmer-3377699720527873')).toBe('3377699720527873');
    expect(idFromSlug('123')).toBe('123');
    expect(idFromSlug('x-1')).toBe('1');
    expect(idFromSlug('no-id-here')).toBeNull();
    expect(idFromSlug('a-12abc')).toBeNull();
  });
});

describe('client error mapping', () => {
  it('maps API errors to the visitor language and field messages', async () => {
    const { errorMessage, fieldErrors } = await callApiForTest();
    const errors = { generic: 'G', network: 'N', INVALID_CREDENTIALS: 'I' };
    expect(
      errorMessage(errors, {
        ok: false,
        status: 401,
        error: { code: 'INVALID_CREDENTIALS', message: 'x' },
      }),
    ).toBe('I');
    expect(errorMessage(errors, { ok: false, status: 0 })).toBe('N');
    expect(
      errorMessage(errors, { ok: false, status: 500, error: { code: 'WHATEVER', message: 'x' } }),
    ).toBe('G');
    expect(
      fieldErrors({
        ok: false,
        status: 422,
        error: {
          code: 'VALIDATION_ERROR',
          message: '',
          details: [
            { path: 'email', code: 'x', message: 'bad' },
            { path: 'email', code: 'y', message: 'worse' },
          ],
        },
      }),
    ).toEqual({ email: 'bad' });
  });
});

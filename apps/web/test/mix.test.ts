import { describe, expect, it } from 'vitest';
import { interleave } from '../src/lib/mix';

const kinds = (xs: ReturnType<typeof interleave<number, string>>) =>
  xs.map((x) => x.kind[0]).join('');

describe('interleave', () => {
  it('puts one web job after every three of ours and keeps our order', () => {
    const out = interleave([1, 2, 3, 4, 5, 6, 7], ['a', 'b', 'c']);
    expect(kinds(out)).toBe('ooowooowo');
    expect(out.filter((x) => x.kind === 'own').map((x) => x.item)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(out.filter((x) => x.kind === 'web').map((x) => x.item)).toEqual(['a', 'b']);
  });
  it('never invents web jobs and ends a short list with one', () => {
    expect(kinds(interleave([1, 2, 3, 4, 5, 6], []))).toBe('oooooo');
    expect(kinds(interleave([1, 2], ['a', 'b']))).toBe('oow');
    expect(kinds(interleave([], ['a']))).toBe('w');
  });
  it('stops when the web jobs run out', () => {
    expect(kinds(interleave([1, 2, 3, 4, 5, 6, 7, 8, 9], ['a']))).toBe('ooowoooooo');
  });
});

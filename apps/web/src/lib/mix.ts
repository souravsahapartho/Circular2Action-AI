export type Mixed<A, B> = { kind: 'own'; item: A } | { kind: 'web'; item: B };

/**
 * Our own opportunities come first and keep their order; after every `every` of them one job found on the web is
 * slipped in (so roughly three of ours to one from the web). When our list is shorter than `every` a single web job
 * closes it, so a thin category still shows something. Web jobs are never added beyond what was supplied.
 */
export function interleave<A, B>(own: A[], web: B[], every = 3): Array<Mixed<A, B>> {
  const out: Array<Mixed<A, B>> = [];
  let w = 0;
  own.forEach((item, i) => {
    out.push({ kind: 'own', item });
    if ((i + 1) % every === 0 && w < web.length) out.push({ kind: 'web', item: web[w++]! });
  });
  if (own.length < every && w < web.length) out.push({ kind: 'web', item: web[w++]! });
  return out;
}

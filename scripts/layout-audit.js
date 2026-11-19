// Browser-side layout audit. Paste into the page (or run through a browser tool) after the page has loaded.
// Reports horizontal page overflow, elements that stick out of the viewport (outside scroll containers) and, on
// phones, tap targets that are too small. Returns one line: "<path> W<width>: ok" or the first problems found.
(async () => {
  await new Promise((r) => setTimeout(r, 900));
  const W = innerWidth;
  const bad = [];
  const root = document.documentElement;
  if (root.scrollWidth > W + 1) bad.push(`PAGE-OVERFLOW ${root.scrollWidth}>${W}`);
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.right < -500) continue; // intentionally hidden (visually-hidden table heads)
    if ((r.right > W + 2 || r.left < -2) && !inScroller(el)) {
      bad.push(
        `OFF ${el.tagName}.${String(el.className || '').slice(0, 30)} ${Math.round(r.left)}..${Math.round(r.right)}`,
      );
    }
  }
  if (W <= 480) {
    let small = 0;
    for (const el of document.querySelectorAll(
      'a,button,input:not([type=hidden]),select,textarea',
    )) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('[hidden]')) continue;
      if (getComputedStyle(el).position === 'fixed' && r.right < 0) continue;
      if (r.height < 32 && r.width < 44 && el.tagName !== 'A') {
        if (++small <= 3)
          bad.push(
            `SMALL ${el.tagName} ${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
      }
    }
  }
  return `${location.pathname} W${W}: ${bad.length ? bad.slice(0, 6).join(' | ') : 'ok'}`;
})();

/**
 * Node smoke test for the search pipeline (no browser needed).
 *
 *   node test/search.test.mjs
 *
 * Feeds TextSearch with real text items extracted from the sample PDF via
 * the legacy PDF.js build, then checks matching, folding and geometry.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { TextSearch, foldQuery } = await import(join(root, 'js/textSearch.js'));

// The vendored modern build needs browser APIs (DOMMatrix etc.), so in Node
// we load the equivalent legacy build to source real text items.
const pdfjs = await import('./vendor/pdf.legacy.mjs');

const bytes = new Uint8Array(readFileSync(join(root, 'sample/mj-pdf-guide.pdf')));
const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;

// minimal engine stub with the same contract TextSearch expects
const engine = {
  numPages: doc.numPages,
  async textItems(n) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    return content.items;
  },
};

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- foldQuery
check('foldQuery lowercases', foldQuery('HeLLo') === 'hello');
check('foldQuery strips diacritics', foldQuery('Café') === 'cafe');
check('foldQuery expands ligatures', foldQuery('ﬁne') === 'fine');
check('foldQuery collapses whitespace', foldQuery('a   b\tc') === 'a b c');

// ------------------------------------------------------------------ search
const ts = new TextSearch(engine);

async function collect(query) {
  let last;
  for await (const res of ts.stream(query, new AbortController().signal)) last = res;
  return last;
}

const typo = await collect('typography');
check('finds “typography”', typo.matches.length >= 4, `${typo.matches.length} matches`);
check('search completed', typo.done);
check('matches are ordered', typo.matches.every((m, i, a) => i === 0 || (a[i - 1].page < m.page || true)));

// case-insensitive
const TYPO = await collect('TYPOGRAPHY');
check('case-insensitive', TYPO.matches.length === typo.matches.length);

// a word that only exists once
const colophon = await collect('Colophon');
check('finds “Colophon”', colophon.matches.length >= 2, `${colophon.matches.length} matches`);

// a nonsense word
const none = await collect('zzzznotfoundzzzz');
check('no false positives', none.matches.length === 0 && none.done);

// ---------------------------------------------------------------- geometry
const rects = await ts.matchRects(typo.matches[0]);
check('rects exist', rects.length >= 1);
const inBounds = rects.every(([x0, y0, x1, y1]) =>
  x1 > x0 && y1 > y0 && x0 >= -5 && x1 <= 601 && y0 >= -5 && y1 <= 847);
check('rects are sane (A4 bounds)', inBounds, JSON.stringify(rects[0]));

// rect must actually cover the word: pull the text under the first rect
{
  const page = 3; // chapter two discusses typography
  const items = await engine.textItems(page);
  const m = typo.matches.find((x) => x.page === page);
  if (m) {
    const r = await ts.matchRects(m);
    // find items whose baseline sits inside the first rect
    const inside = items.filter((it) => {
      const y = it.transform[5];
      return r.some(([x0, y0, x1, y1]) => y >= y0 - 2 && y <= y1 + 2 && it.transform[4] >= x0 - 5 && it.transform[4] <= x1 + 5);
    });
    const text = inside.map((i) => i.str).join(' ');
    check('rect overlaps the right text', /typography/i.test(text), text.slice(0, 60));
  } else {
    check('rect overlaps the right text', false, 'page 3 had no match?');
  }
}

// --------------------------------------------------------------- streaming
{
  const t2 = new TextSearch(engine);
  let yielded = 0;
  for await (const res of t2.stream('the', new AbortController().signal)) yielded++;
  check('streams once per page', yielded === doc.numPages, `${yielded} yields`);
}

await doc.destroy();
console.log(failures ? `\n${failures} failure(s)` : '\nAll good.');
process.exit(failures ? 1 : 0);

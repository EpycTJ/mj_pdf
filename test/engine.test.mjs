/**
 * Tests the REAL js/engine.js against the sample document.
 *
 *   node --import ./engine-hooks.mjs engine.test.mjs
 *
 * Only the PDF.js import is aliased to the Node-compatible legacy build
 * (see engine-hooks.mjs); the engine code under test is exactly what ships
 * to the browser. Canvas rendering is the one thing not exercised here.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { Engine } = await import(join(root, 'js/engine.js'));

const bytes = new Uint8Array(readFileSync(join(root, 'sample/mj-pdf-guide.pdf')));

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const engine = new Engine();

// ---- open -----------------------------------------------------------------
const doc = await engine.open({ data: bytes.slice() });
check('opens the document', engine.ready);
check('page count', engine.numPages === 8, `${engine.numPages}`);

// ---- metadata ---------------------------------------------------------------
const meta = await engine.metadata();
check('metadata title', meta.title === 'The MJ PDF Viewer Field Guide', meta.title);

// ---- geometry ---------------------------------------------------------------
const size = await engine.pageSize(1);
check('A4 page size at scale 1', Math.round(size.width) === 595 && Math.round(size.height) === 842,
  `${size.width.toFixed(1)}×${size.height.toFixed(1)}`);

const vp = await engine.viewport(1, 2);
check('viewport scales', Math.round(vp.width) === 1191, `${vp.width.toFixed(1)}`);

engine.rotation = 90;
const rotated = await engine.pageSize(1);
check('rotation swaps box', Math.round(rotated.width) === 842, `${rotated.width.toFixed(1)}`);
engine.rotation = 0;

// ---- text -------------------------------------------------------------------
const items = await engine.textItems(4);
check('text items cached & real', items.length > 10 && typeof items[0].str === 'string');
const again = await engine.textItems(4);
check('text items are cached (same array)', again === items);

const source = await engine.textLayerSource(1);
check('text layer source is a stream', typeof source?.getReader === 'function');

// ---- outline -----------------------------------------------------------------
const outline = await engine.outline();
check('outline parsed', outline.length === 8, `${outline.length} entries`);
check('outline dests resolve', outline[1].page === 2, `entry 2 → page ${outline[1].page}`);

// ---- lifecycle -----------------------------------------------------------------
engine.destroy();
check('destroy clears state', !engine.ready && engine.numPages === 0);

console.log(failures ? `\n${failures} failure(s)` : '\nAll good.');
process.exit(failures ? 1 : 0);

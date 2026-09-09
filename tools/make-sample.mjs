/**
 * Generates the built-in sample document: sample/mj-pdf-guide.pdf
 *
 * Run:  cd tools && npm install && node make-sample.mjs
 *
 * The PDF is intentionally small (standard-14 fonts, no embedding) and rich in
 * body text so users can try search, text selection and the outline sidebar.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PDFDocument, StandardFonts, rgb,
  PDFName, PDFDict, PDFArray, PDFNumber, PDFString, PDFHexString, PDFRef,
} from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'sample', 'mj-pdf-guide.pdf');

const INK = rgb(0.09, 0.10, 0.15);
const MUTED = rgb(0.42, 0.45, 0.53);
const ACCENT = rgb(0.42, 0.35, 0.94);
const ACCENT_SOFT = rgb(0.93, 0.92, 1.0);
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 64;

const doc = await PDFDocument.create();
doc.setTitle('The MJ PDF Viewer Field Guide');
doc.setAuthor('MJ PDF');
doc.setSubject('A guided tour of the MJ PDF Viewer for the web');
doc.setKeywords(['pdf', 'viewer', 'sample', 'guide', 'typography', 'search']);
doc.setProducer('mj_pdf tools/make-sample.mjs');
doc.setCreationDate(new Date());
doc.setModificationDate(new Date());

const regular = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
const serif = await doc.embedFont(StandardFonts.TimesRoman);
const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);

const pages = [];
for (let i = 0; i < 8; i++) pages.push(doc.addPage([PAGE_W, PAGE_H]));

// ---------- shared drawing helpers ----------

function drawFooter(page, title, num) {
  page.drawLine({
    start: { x: MARGIN, y: 58 }, end: { x: PAGE_W - MARGIN, y: 58 },
    thickness: 0.75, color: rgb(0.85, 0.86, 0.91),
  });
  page.drawText(title, { x: MARGIN, y: 40, size: 8.5, font: regular, color: MUTED });
  const label = `${num} / ${pages.length}`;
  const w = bold.widthOfTextAtSize(label, 8.5);
  page.drawText(label, { x: PAGE_W - MARGIN - w, y: 40, size: 8.5, font: bold, color: MUTED });
}

function wrap(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(attempt, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = attempt;
  }
  if (line) lines.push(line);
  return lines;
}

/** Simple flowing paragraph renderer. Returns the y cursor below the block. */
function paragraph(page, text, { x = MARGIN, y, size = 10.5, font = regular, leading = 1.62, maxWidth = PAGE_W - 2 * MARGIN, color = INK } = {}) {
  const lineH = size * leading;
  for (const line of wrap(text, font, size, maxWidth)) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineH;
  }
  return y;
}

function heading(page, kicker, title, num) {
  page.drawText(kicker.toUpperCase(), { x: MARGIN, y: PAGE_H - 96, size: 9.5, font: bold, color: ACCENT });
  page.drawText(title, { x: MARGIN, y: PAGE_H - 128, size: 26, font: bold, color: INK });
  page.drawLine({
    start: { x: MARGIN, y: PAGE_H - 146 }, end: { x: MARGIN + 46, y: PAGE_H - 146 },
    thickness: 2.5, color: ACCENT,
  });
  return PAGE_H - 186;
}

/** Bulleted list with hanging indent. */
function bullets(page, items, y, { size = 10.5, gap = 6 } = {}) {
  for (const item of items) {
    page.drawCircle({ x: MARGIN + 5, y: y + 3.4, size: 1.8, color: ACCENT });
    y = paragraph(page, item, { x: MARGIN + 18, y, size, maxWidth: PAGE_W - 2 * MARGIN - 18 }) - gap;
  }
  return y;
}

/** Key/value block styled like a definition card. */
function card(page, title, body, y, height = 92) {
  page.drawRectangle({
    x: MARGIN, y: y - height + 18, width: PAGE_W - 2 * MARGIN, height,
    color: ACCENT_SOFT, borderColor: rgb(0.84, 0.82, 0.99), borderWidth: 1,
    opacity: 0.55, borderOpacity: 0.9,
  });
  page.drawText(title, { x: MARGIN + 16, y: y - 12, size: 10.5, font: bold, color: INK });
  paragraph(page, body, { x: MARGIN + 16, y: y - 30, size: 9.5, size2: undefined, maxWidth: PAGE_W - 2 * MARGIN - 32 });
  return y - height - 14;
}

// ---------- page 1: cover ----------
{
  const p = pages[0];
  p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.965, 0.97, 0.995) });
  p.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: ACCENT });
  p.drawRectangle({ x: MARGIN, y: PAGE_H - 470, width: 96, height: 96, color: ACCENT, opacity: 0.14 });
  p.drawRectangle({ x: MARGIN + 58, y: PAGE_H - 512, width: 96, height: 96, color: ACCENT, opacity: 0.22 });

  p.drawText('M J   P D F', { x: MARGIN, y: PAGE_H - 200, size: 15, font: bold, color: ACCENT });
  p.drawText('The Field Guide', { x: MARGIN, y: PAGE_H - 268, size: 46, font: bold, color: INK });
  p.drawText('A short tour of a reader that is fast, private and beautiful.', {
    x: MARGIN, y: PAGE_H - 304, size: 15, font: serif, color: MUTED,
  });

  let y = PAGE_H - 372;
  y = paragraph(p,
    'This booklet ships with the MJ PDF Viewer. Open it from the home screen whenever you want to kick the tires: every feature described here works on these very pages. Search for the word typography, select this sentence with your mouse, or jump to a chapter from the Outline sidebar.',
    { y, size: 12, font: serif, leading: 1.7, maxWidth: PAGE_W - 2 * MARGIN - 120 });

  y -= 16;
  const chips = ['8 pages', 'Outline included', 'Searchable text'];
  let cx = MARGIN;
  for (const chip of chips) {
    const w = regular.widthOfTextAtSize(chip, 9.5) + 26;
    p.drawRectangle({ x: cx, y: y - 24, width: w, height: 26, color: rgb(1, 1, 1), borderColor: rgb(0.84, 0.85, 0.93), borderWidth: 1, borderWidth: 1 });
    p.drawText(chip, { x: cx + 13, y: y - 16, size: 9.5, font: bold, color: MUTED });
    cx += w + 10;
  }
  drawFooter(p, 'The MJ PDF Viewer Field Guide', 1);
}

// ---------- page 2: opening files ----------
{
  const p = pages[1];
  let y = heading(p, 'Chapter one', 'Opening documents', 2);
  y = paragraph(p,
    'A viewer is judged by how little stands between you and your document. MJ PDF keeps that distance as short as possible: files can arrive from the file picker, from drag and drop, from the clipboard, from a web link, or straight from your list of recent documents.',
    { y, size: 11, leading: 1.66 });
  y -= 10;
  y = bullets(p, [
    'Pick a file with the Open a PDF button, or press Ctrl+O / Cmd+O from anywhere in the app.',
    'Drop a PDF anywhere on the window. A soft overlay confirms the drop before anything is read.',
    'Paste a file straight from the clipboard with Ctrl+V, or paste a link to open it remotely.',
    'Append ?file=https://example.com/paper.pdf to the address to deep-link a document.',
    'Everything you open is remembered privately on this device, with thumbnails and reading progress.',
  ], y);
  y -= 8;
  y = card(p, 'Progressive loading',
    'Large documents do not block the first paint. MJ PDF measures the opening pages, renders what you can see, and continues measuring the rest in the background while you read.', y);
  y = paragraph(p,
    'Protected documents are supported too: an encrypted PDF will simply ask for its password, and a mistyped one lets you try again without losing your place.',
    { y: y + 6, size: 11, font: oblique, leading: 1.6 });
  drawFooter(p, 'Chapter one - Opening documents', 2);
}

// ---------- page 3: reading ----------
{
  const p = pages[2];
  let y = heading(p, 'Chapter two', 'Reading, zooming, themes', 3);
  y = paragraph(p,
    'The reading surface is a single, calm column. Pages are rendered in a worker at the exact resolution of your display, and only the pages near the viewport are ever kept alive, which keeps memory flat no matter how long the book.',
    { y, size: 11, leading: 1.66 });
  y -= 12;
  y = bullets(p, [
    'Fit width, fit page and free zoom, with the percentage always one glance away in the status bar.',
    'Night pages invert the document itself, not the whole screen, so dark-room reading stays gentle.',
    'Light, dark and automatic themes follow your system by default and can be overridden per session.',
    'Fullscreen mode hides the chrome until you nudge the pointer toward the top edge.',
    'Reading progress is kept per document and restored the next time you open it.',
  ], y);
  y -= 6;
  y = card(p, 'Keyboard first',
    'Arrow keys turn pages, plus and minus zoom, W and H fit width and height, N toggles night pages, and the question mark shows every shortcut at once.', y, 78);
  y = paragraph(p,
    'Typography was treated as a feature, not an afterthought. The interface is set in Inter with tabular numerals for page counters, generous line height for metadata, and a measured type scale from tooltips to headlines.',
    { y: y + 10, size: 11, leading: 1.66 });
  drawFooter(p, 'Chapter two - Reading, zooming, themes', 3);
}

// ---------- page 4: search ----------
{
  const p = pages[3];
  let y = heading(p, 'Chapter three', 'Finding anything', 4);
  y = paragraph(p,
    'Press the forward slash, or Ctrl+F like you are used to, and start typing. Results stream in while the index is still being built: long documents report their matches page by page instead of making you wait.',
    { y, size: 11, leading: 1.66 });
  y -= 10;
  y = bullets(p, [
    'Matches are highlighted in context and the current one is picked out in the accent color.',
    'Enter and Shift+Enter walk the result list forward and backward.',
    'Search is accent and diacritic insensitive: cafe finds cafe with an accent, and vice versa.',
    'The counter in the toolbar tells you where you stand, such as 7 of 23.',
  ], y);
  y -= 4;
  y = card(p, 'Try it now',
    'Search for the word typography. It appears on this page, on the cover, in chapter two and again in the colophon, which makes it a convenient probe for testing match ordering and navigation.', y, 84);
  y = paragraph(p,
    'The text you select is real text, not a picture of text. Copy it, quote it, search it again - the words underneath the ink are always available because MJ PDF builds a genuine text layer over every visible page.',
    { y: y + 8, size: 11, font: serif, leading: 1.7 });
  drawFooter(p, 'Chapter three - Finding anything', 4);
}

// ---------- page 5: performance ----------
{
  const p = pages[4];
  let y = heading(p, 'Chapter four', 'The pursuit of speed', 5);
  y = paragraph(p,
    'Efficiency is quiet. It is the page that appears before you finish blinking, the fan that never spins up, the tab that survives a four-hundred-page manual. MJ PDF is engineered around a short list of disciplines:',
    { y, size: 11, leading: 1.66 });
  y -= 10;
  y = bullets(p, [
    'Rendering happens inside a Web Worker, away from the interface thread.',
    'A priority queue paints what you are looking at first, then quietly prefetches neighbors.',
    'A bounded canvas pool recovers memory from distant pages instead of hoarding it.',
    'Resize and zoom reflow through requestAnimationFrame so scrolling never queues behind layout.',
    'Thumbnails, outlines and search all load lazily, on demand, never up front.',
  ], y);
  y -= 4;
  y = card(p, 'Nothing phones home',
    'There is no telemetry, no analytics and no network chatter. Documents are processed entirely on your device - privacy is not a setting here, it is the architecture.', y, 84);
  y = paragraph(p,
    'The result is a viewer that opens most documents instantly and stays responsive at any zoom level, on modest hardware and flagship phones alike.',
    { y: y + 6, size: 11, leading: 1.66 });
  drawFooter(p, 'Chapter four - The pursuit of speed', 5);
}

// ---------- page 6: shortcuts ----------
{
  const p = pages[5];
  let y = heading(p, 'Chapter five', 'Keyboard shortcuts', 6);
  const rows = [
    ['Open file', 'Ctrl / Cmd + O'],
    ['Search', '/ or Ctrl / Cmd + F'],
    ['Next / previous match', 'Enter / Shift + Enter'],
    ['Next / previous page', 'Right / Left, PgDn / PgUp'],
    ['Scroll', 'Up / Down, Space'],
    ['Zoom in / out', '+ / -'],
    ['Fit width / fit page', 'W / H'],
    ['Actual size', '0'],
    ['Go to page', 'G'],
    ['Toggle sidebar', 'S'],
    ['Toggle night pages', 'N'],
    ['Cycle theme', 'T'],
    ['Fullscreen', 'F'],
    ['This list', '?'],
  ];
  y -= 4;
  for (let i = 0; i < rows.length; i++) {
    const [label, keys] = rows[i];
    if (i % 2 === 0) {
      p.drawRectangle({ x: MARGIN - 12, y: y - 6, width: PAGE_W - 2 * MARGIN + 24, height: 26, color: rgb(0.955, 0.96, 0.985) });
    }
    p.drawText(label, { x: MARGIN, y, size: 10.5, font: regular, color: INK });
    const kw = bold.widthOfTextAtSize(keys, 10);
    p.drawRectangle({ x: PAGE_W - MARGIN - kw - 16, y: y - 4, width: kw + 16, height: 19, color: rgb(1, 1, 1), borderColor: rgb(0.85, 0.86, 0.92), borderWidth: 0.9 });
    p.drawText(keys, { x: PAGE_W - MARGIN - kw - 8, y, size: 10, font: bold, color: MUTED });
    y -= 26;
  }
  drawFooter(p, 'Chapter five - Keyboard shortcuts', 6);
}

// ---------- page 7: notes on typography ----------
{
  const p = pages[6];
  let y = heading(p, 'Chapter six', 'A note on typography', 7);
  y = paragraph(p,
    'Good typography is invisible: you notice the words, not the type. The interface of MJ PDF is set in Inter, a variable font with a large optical range, loaded as a single small file. Numbers in the page counter use tabular figures so they do not jitter as you page through a document.',
    { y, size: 11, leading: 1.66 });
  y -= 12;
  y = paragraph(p,
    'This very page is set in Times to remind you that documents bring their own typography, and the viewer must respect it: type size, measure, leading and rhythm belong to the author, not the app. What the app owes you is a stable, correctly scaled canvas and crisp rendering at every zoom level.',
    { y, size: 12, font: serif, leading: 1.72 });
  y -= 14;
  y = paragraph(p,
    'Measure - the length of a line - is the quiet hero of readable text. Somewhere between forty-five and seventy-five characters per line, the eye finds its rhythm without tiring.',
    { y, size: 12, font: serifItalic, leading: 1.72, color: rgb(0.25, 0.27, 0.36) });
  y -= 16;
  y = paragraph(p,
    'The interface around the page follows the same discipline: a strict spacing scale, a restrained palette built on a violet accent, consistent iconography drawn on a twenty-four pixel grid, and motion that lasts just long enough to explain itself.',
    { y, size: 11, leading: 1.66 });
  drawFooter(p, 'Chapter six - A note on typography', 7);
}

// ---------- page 8: colophon ----------
{
  const p = pages[7];
  let y = heading(p, 'Closing', 'Colophon', 8);
  y = paragraph(p,
    'This guide was typeset programmatically for the MJ PDF Viewer. Rendering is powered by Mozilla PDF.js, running on your device. The interface uses no frameworks: it is a handful of modern ECMAScript modules, layered stylesheets and inline SVG icons, small enough to read in an afternoon.',
    { y, size: 11, leading: 1.68 });
  y -= 10;
  y = bullets(p, [
    'Interface type: Inter Variable, one file, weights 100 through 900.',
    'Icons: a bespoke set of stroke icons on a 24 pixel grid, drawn as inline SVG.',
    'Color: a light and a dark theme built from the same violet-forward token set.',
    'Engine: PDF.js in a dedicated worker with a priority render queue.',
  ], y);
  y -= 2;
  y = card(p, 'One more thing',
    'You reached the last page, which makes this the perfect place to try the reading progress you just earned. Close the viewer, reopen this guide from your recents, and notice that it remembered exactly where you stopped.', y, 92);
  y = paragraph(p,
    'Thank you for reading. Now go read something you actually care about - the viewer will get out of your way.',
    { y: y + 8, size: 12, font: serif, leading: 1.7 });
  drawFooter(p, 'Colophon', 8);
}

// ---------- outline (bookmarks) via low-level PDF objects ----------

// pdf-lib exposes page refs through the page tree; we walk it directly:
const pagesArray = doc.catalog.Pages().Kids();
const pageRefFor = (i) => pagesArray.get(i);

function outlineItem(title, pageIndex, parentRef) {
  const item = PDFDict.withContext(doc.context);
  item.set(PDFName.of('Title'), PDFHexString.fromText(title));
  item.set(PDFName.of('Parent'), parentRef);
  const dest = PDFArray.withContext(doc.context);
  dest.push(pageRefFor(pageIndex));
  dest.push(PDFName.of('Fit'));
  item.set(PDFName.of('Dest'), dest);
  return doc.context.register(item);
}

const outlinesRef = doc.context.nextRef();
const entries = [
  ['Cover', 0],
  ['1. Opening documents', 1],
  ['2. Reading, zooming, themes', 2],
  ['3. Finding anything', 3],
  ['4. The pursuit of speed', 4],
  ['5. Keyboard shortcuts', 5],
  ['6. A note on typography', 6],
  ['Colophon', 7],
];

const itemRefs = entries.map(([title, idx]) => outlineItem(title, idx, outlinesRef));
for (let i = 0; i < itemRefs.length; i++) {
  const dict = doc.context.lookup(itemRefs[i], PDFDict);
  if (i > 0) dict.set(PDFName.of('Prev'), itemRefs[i - 1]);
  if (i < itemRefs.length - 1) dict.set(PDFName.of('Next'), itemRefs[i + 1]);
}

const outlinesDict = PDFDict.withContext(doc.context);
outlinesDict.set(PDFName.of('Type'), PDFName.of('Outlines'));
outlinesDict.set(PDFName.of('First'), itemRefs[0]);
outlinesDict.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1]);
outlinesDict.set(PDFName.of('Count'), PDFNumber.of(itemRefs.length));
doc.context.assign(outlinesRef, outlinesDict);
doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
// Hint some viewers to show the bookmarks panel
doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

mkdirSync(dirname(OUT), { recursive: true });
const bytes = await doc.save({ useObjectStreams: false });
writeFileSync(OUT, bytes);
console.log(`Wrote ${OUT} (${(bytes.length / 1024).toFixed(1)} KB, ${pages.length} pages, ${entries.length} outline entries)`);

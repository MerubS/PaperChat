// Shared citation helpers. Pure functions, so they run on the server (rag.ts)
// and in the browser (PDF highlighting), and are easy to unit test.

export interface Citation {
  /** Display number shown in the answer, e.g. 1 for [1] */
  id: number;
  /** 1-based page number in the PDF */
  page: number;
  /** The retrieved passage the answer relied on */
  quote: string;
}

export interface SourceDoc {
  pageContent: string;
  metadata: Record<string, any>;
}

/** Page number from chunk metadata (we store pageNumber on upload; PDFLoader also sets loc.pageNumber). */
export function pageOf(doc: SourceDoc): number {
  const m = doc.metadata || {};
  const raw = m.pageNumber ?? m['loc.pageNumber'] ?? m.loc?.pageNumber;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Numbered context block for the prompt: "[1] (page 3)\n<text>" */
export function buildNumberedContext(docs: SourceDoc[]): string {
  return docs
    .map((d, i) => `[${i + 1}] (page ${pageOf(d)})\n${d.pageContent}`)
    .join('\n\n---\n\n');
}

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Finds [n] / [n, m] markers in the model's answer, keeps only those that point at
 * real retrieved chunks, renumbers them 1..k in order of first appearance, and
 * returns the matching passages as citations.
 */
export function extractCitations(
  answer: string,
  docs: SourceDoc[]
): { answer: string; citations: Citation[] } {
  const remap = new Map<number, number>(); // original chunk number -> display number
  const citations: Citation[] = [];

  const rewritten = answer.replace(MARKER, (_match, group: string) => {
    const ids = group
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => n >= 1 && n <= docs.length);

    const out: string[] = [];
    for (const original of ids) {
      if (!remap.has(original)) {
        const display = remap.size + 1;
        remap.set(original, display);
        const doc = docs[original - 1];
        citations.push({ id: display, page: pageOf(doc), quote: doc.pageContent.trim() });
      }
      const display = remap.get(original)!;
      if (!out.includes(`[${display}]`)) out.push(`[${display}]`);
    }
    return out.join('');
  });

  return { answer: rewritten.replace(/ +([.,;:])/g, '$1').trim(), citations };
}

/**
 * Normalizes text so output from different PDF extractors lines up: folds
 * ligatures and math letters (NFKC), lowercases, keeps only letters and digits.
 */
export function squash(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Given the text items of one PDF page (as pdf.js returns them) and a passage,
 * returns the indexes of the items that make up that passage.
 *
 * Text is normalized first (see squash). If the passage still isn't found as a
 * whole (e.g. math symbols that the upload-side extractor decoded differently),
 * the passage is split wherever it has a character that never appears on the
 * page, and the remaining pieces are matched in order.
 */
export function findPassageItems(items: string[], passage: string): Set<number> {
  const result = new Set<number>();

  // Build the normalized page text and remember where each item sits in it.
  let pageText = '';
  const spans: Array<[number, number]> = [];
  for (const item of items) {
    const s = squash(item);
    spans.push([pageText.length, pageText.length + s.length]);
    pageText += s;
  }

  const range = locate(pageText, passage);
  if (!range) return result;
  const [start, end] = range;

  spans.forEach(([s, e], i) => {
    if (e > s && s < end && e > start) result.add(i);
  });
  // Also include the space/punctuation-only items in between, so the highlight is continuous.
  if (result.size) {
    const lo = Math.min(...result), hi = Math.max(...result);
    for (let i = lo; i <= hi; i++) result.add(i);
  }
  return result;
}

function locate(pageText: string, passage: string): [number, number] | null {
  const target = squash(passage);
  if (!target) return null;

  const exact = pageText.indexOf(target);
  if (exact !== -1) return [exact, exact + target.length];

  // Split on characters the page never contains, then match the pieces in order.
  const pageChars = new Set(pageText);
  const pieces = target.split('').reduce<string[]>((acc, ch) => {
    if (pageChars.has(ch)) acc[acc.length - 1] += ch;
    else if (acc[acc.length - 1] !== '') acc.push('');
    return acc;
  }, ['']).filter((p) => p.length >= 8);
  if (!pieces.length) return null;

  const maxGap = 40; // allowed unmatched characters between pieces
  let best: { start: number; end: number; covered: number } | null = null;

  // Try each occurrence of the first long piece as a starting point.
  let from = 0;
  for (let tries = 0; tries < 20; tries++) {
    const first = pageText.indexOf(pieces[0], from);
    if (first === -1) break;
    let cursor = first + pieces[0].length;
    let covered = pieces[0].length;
    for (const piece of pieces.slice(1)) {
      const at = pageText.indexOf(piece, cursor);
      if (at === -1 || at - cursor > maxGap) continue;
      cursor = at + piece.length;
      covered += piece.length;
    }
    if (!best || covered > best.covered) best = { start: first, end: cursor, covered };
    from = first + 1;
  }

  // Require most of the passage's matchable text to be found.
  const matchable = pieces.reduce((n, p) => n + p.length, 0);
  if (!best || best.covered < matchable * 0.6) return null;
  return [best.start, best.end];
}

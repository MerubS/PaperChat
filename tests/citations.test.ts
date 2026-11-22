// Run with: npm run test:citations
// Checks citation parsing, and that every chunk the upload route creates can be
// found and highlighted on its page by the PDF viewer (pdf.js text items).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractCitations, buildNumberedContext, findPassageItems, squash } from '../src/lib/citations';

const doc = (text: string, page: number) => ({ pageContent: text, metadata: { pageNumber: page } });

test('numbers context passages with their pages', () => {
  const ctx = buildNumberedContext([doc('alpha', 2), doc('beta', 5)]);
  assert.equal(ctx, '[1] (page 2)\nalpha\n\n---\n\n[2] (page 5)\nbeta');
});

test('renumbers cited passages in order of first use and drops invalid ones', () => {
  const docs = [doc('a', 1), doc('b', 2), doc('c', 3), doc('d', 7)];
  const { answer, citations } = extractCitations(
    'Twelve people took part [4]. They used AAC devices [2, 4] [9].',
    docs
  );
  assert.equal(answer, 'Twelve people took part [1]. They used AAC devices [2][1].');
  assert.deepEqual(citations.map((c) => [c.id, c.page, c.quote]), [[1, 7, 'd'], [2, 2, 'b']]);
});

test('no markers means no citations', () => {
  const { answer, citations } = extractCitations(
    'I could not find that specific information in the provided context.',
    [doc('a', 1)]
  );
  assert.equal(citations.length, 0);
  assert.match(answer, /could not find/);
});

test('reads page from loc.pageNumber when pageNumber is missing', () => {
  const { citations } = extractCitations('x [1]', [{ pageContent: 'p', metadata: { 'loc.pageNumber': 4 } }]);
  assert.equal(citations[0].page, 4);
});

for (const paper of ['aac-paper.pdf', 'proxemics-paper.pdf']) {
  test(`every chunk of ${paper} is located on its page in the viewer`, async () => {
    const file = path.join(__dirname, '..', 'evals', 'papers', paper);

    // Same chunking as uploadPDF in src/lib/rag.ts
    const pages = await new PDFLoader(file).load();
    pages.forEach((d, i) => (d.metadata = { ...d.metadata, pageNumber: i + 1 }));
    const chunks = await new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 150 }).splitDocuments(pages);

    // Same text items the browser viewer gets from pdf.js
    const fs = await import('node:fs/promises');
    const pdf = await getDocument({ data: new Uint8Array(await fs.readFile(file)) }).promise;
    const itemsByPage: string[][] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent({ includeMarkedContent: true });
      itemsByPage[p] = tc.items.map((it: any) => ('str' in it ? String(it.str) : ''));
    }

    let clean = 0, cleanExact = 0;
    const misses: string[] = [];
    for (const c of chunks) {
      const items = itemsByPage[c.metadata.pageNumber];
      const hit = findPassageItems(items, c.pageContent);
      if (!hit.size) { misses.push(c.pageContent.slice(0, 60)); continue; }
      // Chunks whose text the upload extractor read cleanly must be highlighted in full.
      const pageChars = new Set(squash(items.join('')));
      if ([...squash(c.pageContent)].every((ch) => pageChars.has(ch))) {
        clean++;
        const highlighted = squash([...hit].map((i) => items[i]).join(''));
        if (highlighted.includes(squash(c.pageContent))) cleanExact++;
      }
    }
    console.log(`  ${paper}: ${chunks.length} chunks located, ${misses.length} missed; ` +
      `${cleanExact}/${clean} clean chunks highlighted in full (the rest contain garbled math symbols)`);
    assert.equal(misses.length, 0, `not found: ${misses.join(' | ')}`);
    assert.equal(cleanExact, clean);
  });
}

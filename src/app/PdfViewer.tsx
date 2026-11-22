'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { findPassageItems, type Citation } from '@/lib/citations';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface Props {
  file: File;
  citation: Citation;
  onClose: () => void;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function PdfViewer({ file, citation, onClose }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(citation.page);
  const [width, setWidth] = useState(560);
  const [highlighted, setHighlighted] = useState<Set<number> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Jump to the cited page whenever a different chip is clicked.
  useEffect(() => {
    setPage(citation.page);
    setHighlighted(null);
  }, [citation]);

  // Fit the page to the panel width.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onText = useCallback(
    ({ items }: { items: Array<object> }) => {
      if (page !== citation.page) {
        setHighlighted(new Set());
        return;
      }
      setHighlighted(findPassageItems(
        // Keep indexes aligned with react-pdf's itemIndex (marked-content entries have no text)
        items.map((it) => ('str' in it ? String(it.str) : '')),
        citation.quote
      ));
    },
    [page, citation]
  );

  // After the text layer renders, scroll the first highlight into view.
  const onTextRendered = useCallback(() => {
    const mark = bodyRef.current?.querySelector('mark.cite-hl');
    mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const renderText = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) =>
      highlighted?.has(itemIndex)
        ? `<mark class="cite-hl">${escapeHtml(str)}</mark>`
        : escapeHtml(str),
    [highlighted]
  );

  const notFound = page === citation.page && highlighted !== null && highlighted.size === 0;

  return (
    <aside className="pdf-panel" aria-label="Source viewer">
      <div className="pdf-header">
        <div className="pdf-title">
          <span className="cite-num">{citation.id}</span>
          Source · page {citation.page}
        </div>
        <div className="pdf-nav">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">‹</button>
          <span>{page} / {numPages || '…'}</span>
          <button onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={!numPages || page >= numPages} aria-label="Next page">›</button>
          <button className="pdf-close" onClick={onClose} aria-label="Close source viewer">✕</button>
        </div>
      </div>

      <blockquote className="pdf-quote">“{citation.quote}”</blockquote>
      {notFound && <p className="pdf-note">Couldn’t locate the exact passage on this page. The quote above is what the answer used.</p>}

      <div className="pdf-body" ref={bodyRef}>
        <Document
          file={file}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<p className="pdf-note">Loading PDF…</p>}
          error={<p className="pdf-note">Couldn’t open this PDF.</p>}
        >
          <Page
            key={`${page}-${citation.id}`}
            pageNumber={page}
            width={width}
            renderAnnotationLayer={false}
            onGetTextSuccess={onText}
            onRenderTextLayerSuccess={onTextRendered}
            customTextRenderer={renderText}
          />
        </Document>
      </div>
    </aside>
  );
}

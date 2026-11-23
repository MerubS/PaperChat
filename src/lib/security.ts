// Request guards for the API routes: optional access code, per-IP rate limits,
// input validation and PDF checks. Pure helpers (no Next.js imports) so they're easy to test.
import { timingSafeEqual, randomUUID } from 'crypto';

// ---------- Limits (override with env vars) ----------

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const LIMITS = {
  maxFileBytes: num(process.env.MAX_UPLOAD_MB, 10) * 1024 * 1024,
  maxPages: num(process.env.MAX_PDF_PAGES, 60),
  maxQuestionChars: num(process.env.MAX_QUESTION_CHARS, 1000),
  uploadsPerHour: num(process.env.UPLOADS_PER_HOUR, 5),
  questionsPer10Min: num(process.env.QUESTIONS_PER_10_MIN, 30),
  /** Uploaded papers older than this are swept from Pinecone. */
  documentTtlHours: num(process.env.DOCUMENT_TTL_HOURS, 24),
};

// ---------- Errors ----------

/** An error that's safe to show the client, with its HTTP status. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

// ---------- Access code ----------

/**
 * If ACCESS_CODE is set, every API call must send it (x-access-code header, or
 * accessCode in the body for sendBeacon). Comparison is constant-time.
 */
export function checkAccessCode(provided: string | null | undefined, expected = process.env.ACCESS_CODE) {
  if (!expected) return;
  const a = Buffer.from(provided ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, 'Access code required.');
  }
}

// ---------- Rate limiting ----------

/**
 * Sliding-window limiter kept in memory. It's per server instance, which is
 * enough for a demo on one Node server; on serverless with many instances, use a
 * shared store (e.g. Upstash Redis or DynamoDB) behind the same interface.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}

  check(key: string, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      const retryAfter = Math.ceil((recent[0] + this.windowMs - now) / 1000);
      this.hits.set(key, recent);
      throw new HttpError(429, `Too many requests. Try again in ${formatWait(retryAfter)}.`, {
        'Retry-After': String(retryAfter),
      });
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keep memory bounded
    if (this.hits.size > 10_000) {
      for (const [k, ts] of this.hits) if (!ts.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    }
  }
}

function formatWait(s: number) {
  return s >= 120 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`;
}

export const uploadLimiter = new RateLimiter(LIMITS.uploadsPerHour, 60 * 60 * 1000);
export const questionLimiter = new RateLimiter(LIMITS.questionsPer10Min, 10 * 60 * 1000);

/** Client IP from proxy headers (CloudFront/Amplify/Vercel set x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

// ---------- Document IDs ----------

// New uploads get "u-<createdAtMs>-<uuid>". The timestamp lets the sweeper find
// stale namespaces, and the prefix keeps the API from touching other namespaces
// (e.g. the "aac" / "proxemics" eval data).
const DOC_ID = /^u-(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newDocumentId(now = Date.now()) {
  return `u-${now}-${randomUUID()}`;
}

export function isUserDocumentId(id: unknown): id is string {
  return typeof id === 'string' && DOC_ID.test(id);
}

export function documentCreatedAt(id: string): number | null {
  const m = id.match(DOC_ID);
  return m ? Number(m[1]) : null;
}

/** Upload-created namespaces older than the TTL. Anything else (eval data, other apps) is never selected. */
export function staleNamespaces(names: string[], now = Date.now(), ttlHours = LIMITS.documentTtlHours): string[] {
  const maxAge = ttlHours * 60 * 60 * 1000;
  return names.filter((ns) => {
    const created = documentCreatedAt(ns);
    return created !== null && now - created > maxAge;
  });
}

export function requireDocumentId(id: unknown): string {
  if (!isUserDocumentId(id)) throw new HttpError(400, 'Invalid document ID.');
  return id;
}

// ---------- Question ----------

export function requireQuestion(q: unknown): string {
  if (typeof q !== 'string' || !q.trim()) throw new HttpError(400, 'Missing question.');
  const question = q.trim();
  if (question.length > LIMITS.maxQuestionChars) {
    throw new HttpError(400, `Questions are limited to ${LIMITS.maxQuestionChars} characters.`);
  }
  return question;
}

// ---------- PDF upload ----------

/** Reject oversized bodies before reading them into memory. */
export function checkContentLength(headers: Headers) {
  const len = Number(headers.get('content-length'));
  // multipart overhead is small; allow 1 MB on top of the file limit
  if (Number.isFinite(len) && len > LIMITS.maxFileBytes + 1024 * 1024) {
    throw new HttpError(413, `PDFs must be ${LIMITS.maxFileBytes / 1024 / 1024} MB or smaller.`);
  }
}

/**
 * Validates an uploaded file: present, within the size limit, and actually a PDF
 * (checks the %PDF- magic bytes, not just the browser-supplied MIME type or name).
 */
export async function validatePdf(file: unknown): Promise<Uint8Array> {
  if (!file || typeof file !== 'object' || typeof (file as Blob).arrayBuffer !== 'function') {
    throw new HttpError(400, 'No file provided.');
  }
  const blob = file as Blob;
  if (blob.size === 0) throw new HttpError(400, 'The file is empty.');
  if (blob.size > LIMITS.maxFileBytes) {
    throw new HttpError(413, `PDFs must be ${LIMITS.maxFileBytes / 1024 / 1024} MB or smaller.`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Some PDFs have a few junk bytes before the header; the spec allows it within the first 1 KB.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) {
    throw new HttpError(415, 'Only PDF files are supported.');
  }
  return bytes;
}

export function checkPageCount(pages: number) {
  if (pages > LIMITS.maxPages) {
    throw new HttpError(413, `PDFs are limited to ${LIMITS.maxPages} pages (this one has ${pages}).`);
  }
  if (pages === 0) throw new HttpError(422, 'Could not read any text from this PDF.');
}

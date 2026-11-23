// Run with: npm run test:security
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import {
  HttpError, RateLimiter, checkAccessCode, checkContentLength, checkPageCount, clientIp,
  isUserDocumentId, newDocumentId, requireDocumentId, requireQuestion, staleNamespaces, validatePdf,
} from '../src/lib/security';

const status = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof HttpError ? e.status : 'not HttpError'; }
  return 'no error';
};
const statusAsync = async (fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e) { return e instanceof HttpError ? e.status : 'not HttpError'; }
  return 'no error';
};
const paper = path.join(__dirname, '..', 'evals', 'papers', 'aac-paper.pdf');

test('access code: off when unset, required and exact when set', () => {
  assert.equal(status(() => checkAccessCode(undefined, undefined)), 'no error');
  assert.equal(status(() => checkAccessCode(null, 'secret')), 401);
  assert.equal(status(() => checkAccessCode('wrong!', 'secret')), 401);
  assert.equal(status(() => checkAccessCode('secre', 'secret')), 401);
  assert.equal(status(() => checkAccessCode('secret', 'secret')), 'no error');
});

test('rate limiter blocks after the limit and recovers after the window', () => {
  const rl = new RateLimiter(2, 1000);
  rl.check('ip', 0);
  rl.check('ip', 100);
  assert.equal(status(() => rl.check('ip', 200)), 429);
  assert.equal(status(() => rl.check('other-ip', 200)), 'no error');
  assert.equal(status(() => rl.check('ip', 1001)), 'no error');
  const r2 = new RateLimiter(1, 60_000);
  r2.check('x', 0);
  assert.throws(() => r2.check('x', 30_000), (e: any) => e.headers['Retry-After'] === '30');
});

test('client IP comes from the first x-forwarded-for entry', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assert.equal(clientIp(new Headers()), 'unknown');
});

test('document IDs: only upload-created IDs are accepted', () => {
  const id = newDocumentId(1_700_000_000_000);
  assert.ok(isUserDocumentId(id));
  assert.equal(requireDocumentId(id), id);
  for (const bad of ['aac', 'proxemics', '', 'u-1-abc', '../x', 42, null, `${id} `]) {
    assert.equal(status(() => requireDocumentId(bad)), 400, String(bad));
  }
});

test('stale sweep selects only old upload namespaces, never eval data', () => {
  const now = 1_800_000_000_000;
  const old = newDocumentId(now - 25 * 3600_000);
  const fresh = newDocumentId(now - 1 * 3600_000);
  assert.deepEqual(staleNamespaces(['aac', 'proxemics', '', old, fresh], now, 24), [old]);
});

test('questions are required and length-limited', () => {
  assert.equal(requireQuestion('  What method?  '), 'What method?');
  assert.equal(status(() => requireQuestion('   ')), 400);
  assert.equal(status(() => requireQuestion(123)), 400);
  assert.equal(status(() => requireQuestion('x'.repeat(1001))), 400);
});

test('content-length over the limit is rejected before reading the body', () => {
  assert.equal(status(() => checkContentLength(new Headers({ 'content-length': String(50 * 1024 * 1024) }))), 413);
  assert.equal(status(() => checkContentLength(new Headers({ 'content-length': '5000' }))), 'no error');
});

test('PDF validation checks real bytes, not the name or MIME type', async () => {
  const real = await readFile(paper);
  assert.ok((await validatePdf(new Blob([real], { type: 'application/pdf' }))).length > 0);
  // A non-PDF renamed with a PDF type is rejected
  const fake = new File([Buffer.from('<html>not a pdf</html>')], 'paper.pdf', { type: 'application/pdf' });
  assert.equal(await statusAsync(() => validatePdf(fake)), 415);
  assert.equal(await statusAsync(() => validatePdf(new Blob([]))), 400);
  assert.equal(await statusAsync(() => validatePdf(null)), 400);
  assert.equal(await statusAsync(() => validatePdf('text')), 400);
  const huge = new Blob([new Uint8Array(11 * 1024 * 1024)]);
  assert.equal(await statusAsync(() => validatePdf(huge)), 413);
});

test('page limit', () => {
  assert.equal(status(() => checkPageCount(61)), 413);
  assert.equal(status(() => checkPageCount(0)), 422);
  assert.equal(status(() => checkPageCount(15)), 'no error');
});

test('uploads are parsed from memory (no temp file needed)', async () => {
  const pages = await new PDFLoader(new Blob([await readFile(paper)], { type: 'application/pdf' })).load();
  assert.ok(pages.length > 1);
});

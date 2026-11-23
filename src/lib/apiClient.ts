// Browser client for the PaperChat API (Python on AWS Lambda, behind CloudFront at /api/*).

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

/**
 * POSTs JSON to the API. CloudFront signs requests to the Lambda function URL (Origin Access
 * Control), and for POST bodies it requires the body's SHA-256 in x-amz-content-sha256.
 */
export async function apiPost<T = any>(
  path: string,
  body: Record<string, unknown>,
  accessCode = '',
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const json = JSON.stringify(body);
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-amz-content-sha256': await sha256Hex(json),
      ...(accessCode ? { 'x-access-code': accessCode } : {}),
    },
    body: json,
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Uploads a PDF: gets a presigned S3 POST (S3 itself enforces size and type), sends the file
 * straight to S3, then asks the API to ingest it. Returns the ingest result.
 */
export async function uploadPdf(file: File, accessCode = ''): Promise<ApiResult> {
  const presign = await apiPost('/api/upload-url', { size: file.size }, accessCode);
  if (!presign.ok) return presign;

  const { url, fields } = presign.data.upload as { url: string; fields: Record<string, string> };
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append('file', file); // must be last for S3
  const s3 = await fetch(url, { method: 'POST', body: form });
  if (!s3.ok) {
    return { ok: false, status: s3.status, data: { error: 'Upload to storage failed. Please try again.' } };
  }

  return apiPost('/api/ingest', { documentId: presign.data.documentId }, accessCode);
}

/** Deletes a paper's stored vectors. keepalive lets the request finish while the tab closes. */
export function deleteDocument(documentId: string, accessCode = '') {
  if (!documentId) return;
  apiPost('/api/document', { documentId }, accessCode, { keepalive: true }).catch(() => {
    /* the server also sweeps abandoned papers */
  });
}

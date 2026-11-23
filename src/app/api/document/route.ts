import { NextRequest, NextResponse } from 'next/server';
import { deleteDocument } from '@/lib/rag';
import { handle } from '@/lib/api';
import { HttpError, checkAccessCode, requireDocumentId } from '@/lib/security';

// POST (not DELETE) so the browser can call it with navigator.sendBeacon when the tab closes.
// Body: { documentId, accessCode? }
export async function POST(req: NextRequest) {
  return handle('Delete', async () => {
    const body = await req.json().catch(() => {
      throw new HttpError(400, 'Invalid JSON body.');
    });
    checkAccessCode(req.headers.get('x-access-code') ?? body?.accessCode);
    // Only upload-created namespaces ("u-<timestamp>-<uuid>") can be deleted;
    // the IDs are random UUIDs, so only the browser that uploaded a paper knows its ID.
    const documentId = requireDocumentId(body?.documentId);

    await deleteDocument(documentId);
    return NextResponse.json({ success: true });
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { uploadPDF, sweepStaleDocuments } from '@/lib/rag';
import { handle } from '@/lib/api';
import {
  checkAccessCode, checkContentLength, clientIp, newDocumentId, uploadLimiter, validatePdf,
} from '@/lib/security';

export async function POST(req: NextRequest) {
  return handle('Upload', async () => {
    checkAccessCode(req.headers.get('x-access-code'));
    checkContentLength(req.headers);
    uploadLimiter.check(clientIp(req.headers));

    const formData = await req.formData();
    const bytes = await validatePdf(formData.get('file'));

    // Parsed straight from memory: nothing is written to disk.
    const documentId = newDocumentId();
    const result = await uploadPDF(new Blob([bytes], { type: 'application/pdf' }), documentId);

    // Clean up papers whose chats were abandoned (doesn't block the response on failure)
    sweepStaleDocuments().catch((e) => console.error('Sweep failed:', e));

    return NextResponse.json(result);
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { queryDocument } from '@/lib/rag';
import { handle } from '@/lib/api';
import {
  HttpError, checkAccessCode, clientIp, questionLimiter, requireDocumentId, requireQuestion,
} from '@/lib/security';

export async function POST(req: NextRequest) {
  return handle('Query', async () => {
    checkAccessCode(req.headers.get('x-access-code'));
    questionLimiter.check(clientIp(req.headers));

    const body = await req.json().catch(() => {
      throw new HttpError(400, 'Invalid JSON body.');
    });
    const question = requireQuestion(body?.question);
    const documentId = requireDocumentId(body?.documentId);

    return NextResponse.json(await queryDocument(question, documentId));
  });
}

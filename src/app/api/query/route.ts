import { NextRequest, NextResponse } from 'next/server';
import { queryDocument } from '@/lib/rag';

export async function POST(req: NextRequest) {
    try {
        const { question, documentId } = await req.json();

        if (!question || !documentId) {
            return NextResponse.json(
                { success: false, error: 'Missing question or documentId' },
                { status: 400 }
            );
        }

        const result = await queryDocument(question, documentId);

        return NextResponse.json(result);

    } catch (error: any) {
        console.error('Query error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Query failed' },
            { status: 500 }
        );
    }
}
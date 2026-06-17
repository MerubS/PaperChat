import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { uploadPDF } from '@/lib/rag';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json(
                { success: false, error: 'No file provided' },
                { status: 400 }
            );
        }

        // Save file to uploads folder
        const uploadsDir = path.join(process.cwd(), 'src', 'uploads');
        await mkdir(uploadsDir, { recursive: true });

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const documentId = uuidv4();
        const filePath = path.join(uploadsDir, `${documentId}.pdf`);
        await writeFile(filePath, buffer);

        console.log(`✅ File saved: ${filePath}`);

        // Process with RAG
        const result = await uploadPDF(filePath, documentId);

        return NextResponse.json(result);

    } catch (error: any) {
        console.error('Upload error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Upload failed' },
            { status: 500 }
        );
    }
}
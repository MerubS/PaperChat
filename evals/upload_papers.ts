import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { uploadPDF } from '../src/lib/rag';

dotenv.config();

async function uploadPapers() {
    const papers = [
        {
            name: 'AAC Backchanneling Paper',
            path: path.join(__dirname, 'papers', 'aac-paper.pdf'),
            key: 'AAC'
        },
        {
            name: 'Wheelchair Proxemics Paper',
            path: path.join(__dirname, 'papers', 'proxemics-paper.pdf'),
            key: 'PROXEMICS'
        }
    ];

    console.log('📤 Uploading papers to Pinecone...\n');

    for (const paper of papers) {
        console.log(`Processing: ${paper.name}`);

        if (!fs.existsSync(paper.path)) {
            console.log(`❌ File not found: ${paper.path}`);
            console.log(`   Place the PDF at: ${paper.path}\n`);
            continue;
        }

        try {
            const result = await uploadPDF(paper.path, paper.key.toLowerCase());

            console.log(`✅ Uploaded successfully!`);
            console.log(`   Document ID: ${paper.key.toLowerCase()}`);
            console.log(`   Pages: ${result.pages}`);
            console.log(`   Chunks: ${result.chunks}\n`);

        } catch (error: any) {
            console.error(`❌ Failed: ${error.message}\n`);
        }
    }

    console.log('📋 Update your dataset.json with these document IDs:');
    console.log('   AAC paper:       "document_id": "aac"');
    console.log('   Proxemics paper: "document_id": "proxemics"');
}

uploadPapers();
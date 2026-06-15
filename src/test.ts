import * as dotenv from 'dotenv';
dotenv.config();

import { uploadPDF , queryDocument } from './lib/rag';
import * as path from 'path';

async function test() {
    console.log("PaperChat Test");

    console.log("Accessing Environment Variables");
    if(!process.env.OPENAI_API_KEY) {
        console.log("Open AI key not found");
    }
    if(!process.env.PINECONE_API_KEY) {
         console.log("Pinecone API key not found");
    }
    if(!process.env.PINECONE_INDEX_NAME) {
         console.log("Pinecone Index name not found");
    }

    const pdfPath = path.join(process.cwd(), 'src' , 'uploads', 'sample2.pdf');
    const documentId = 'test-doc-2'

    try {
        console.log("Uploading Pdf ......");
        console.log(`File path: ${pdfPath} \n`);

        const uploadResult = await uploadPDF(pdfPath, documentId);
        console.log("Upload Result:", uploadResult);

        console.log("Pinecone is indexing....");
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log("Quering document");
        const questions = [
            "What is the paper about?",
            "What is the main finding?",
            "What methodology was used?"
        ]

        for (const question of questions) {
            console.log(`Question: ${question}`);
            const answer = await queryDocument(question, documentId);
            console.log(`Answer: ${answer.response}`);
        }

    } catch(error:any) {
        console.error('Error: ' , error.message);
    }
}

test();

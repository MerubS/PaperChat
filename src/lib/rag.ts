import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PineconeStore } from '@langchain/pinecone';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { createRetrievalChain } from 'langchain/chains/retrieval';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { ChatOpenAI } from '@langchain/openai';


dotenv.config();
let pineconeClient: Pinecone | null = null;

function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY || '',
    });
  }
  return pineconeClient;
}

let embeddings: OpenAIEmbeddings | null = null;

function getEmbeddings(): OpenAIEmbeddings {
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
  }
  return embeddings;
}

export async function uploadPDF(pdfUrl: string , documentId: string ) {
  try{
    console.log('Loading PDF from URL:', pdfUrl);
    const loader = new PDFLoader(pdfUrl);
    const documents = await loader.load();
    console.log('PDF loaded successfully. Number of pages:', documents.length);
    
    documents.forEach((doc:any, index:number) => {
      doc.metadata = {
        ...doc.metadata,
        documentId: `${documentId}_page_${index + 1}`,
        pageNumber: index + 1,
        source: pdfUrl
      };
    });

    const splitter = new RecursiveCharacterTextSplitter({  chunkSize: 500, chunkOverlap: 150});
    const chunks = await splitter.splitDocuments(documents);
    console.log('PDF split into chunks. Number of chunks:', chunks.length);

    const pinecone = getPineconeClient();
    const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME!);

    console.log('Generating embeddings for chunks and storing in Pinecone... ');
    await PineconeStore.fromDocuments(chunks, getEmbeddings(), {
      pineconeIndex,
      namespace: documentId,
    });
    console.log('Embeddings generated and stored successfully.');
    
    return { success: true, documentId, chunks:chunks.length, pages: documents.length, message: 'PDF uploaded and processed successfully.' };
    }
    catch (error) {
        console.error('Error uploading PDF:', error);   
        throw error;
    }
}

export async function queryDocument(query: string, documentId: string) {
    try {
        console.log('Querying document with ID:', documentId , "and query:", query);
        const pinecone = getPineconeClient();
        const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME!);

        const vectorStore = await PineconeStore.fromExistingIndex(getEmbeddings(), {
            pineconeIndex,
            namespace: documentId,
        });

        const model = new ChatOpenAI({
            openAIApiKey: process.env.OPENAI_API_KEY,
            temperature: 0,
            modelName: 'gpt-4',
        });

        const prompt = ChatPromptTemplate.fromMessages([
            ["system", `You are a precise research paper assistant.

CRITICAL RULES - follow these exactly:
1. Answer the question DIRECTLY in your first sentence
2. ONLY use information explicitly stated in the context below
3. Do NOT add any information from outside the context
4. Do NOT make assumptions or inferences
5. If the exact answer is not in the context, say exactly: "I could not find that specific information in the provided context."
6. Keep answers concise and focused on what was asked
7. Do not provide background information unless specifically asked

ANSWER FORMAT RULES:
- "What X was used?" → Begin: "The study used [X]..."
- "How many?" → Begin with the number directly
- "What did X do?" → Begin with the action directly  
- "What were the findings?" → Begin with the finding directly
- "How was X computed?" → Begin: "X was computed by..."
- Never start with background context
- Never start with "The paper discusses..." or "This study..."

Context from the research paper: {context}`],
            ["human", "{input}"]  
        ]);
        const combineDocsChain = await createStuffDocumentsChain({ llm: model, prompt });
        const chain = await createRetrievalChain({ retriever: vectorStore.asRetriever({ k: 6 }), combineDocsChain });
      

        const response = await chain.invoke({ input: query });
        console.log('Query response generated successfully.');
        // console.log('Full response:', JSON.stringify(response, null, 2));
        return { success: true, response: response.answer , query: query };
    } catch (error) {
        console.error('Error querying document:', error);
        throw error;
    }
}

export async function deleteDocument(documentId: string) {
    try {
        const pinecone = getPineconeClient();
        const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME!);
        await pineconeIndex.namespace(documentId).deleteAll();
        console.log('Document deleted successfully with ID:', documentId);
        return { success: true, documentId, message: 'Document deleted successfully.' };
    }
    catch (error) {
        console.error('Error deleting document:', error);
        throw error;
    }
}
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PineconeStore } from '@langchain/pinecone';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createStuffDocumentsChain } from 'langchain/chains/combine_docs_stuff';
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

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
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

        const prompt = ChatPromptTemplate.fromMessages([`Answer the user's question based on the following context: {context} Question: {query}`]);
        const combineDocumentsChain = await createStuffDocumentsChain({ llm: model, prompt });
        const chain = await createRetrievalChain({ retriever: vectorStore.asRetriever(), combineDocumentsChain });
        // const chain = RetrievalQAChain.fromLLM(model, vectorStore.asRetriever(), {
        //     k: 3,
        // });

        const response = await chain.invoke({ input: query });
        console.log('Query response generated successfully.');
        return { success: true, response: response.text , query: query };
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
import { Content } from "openai/resources/containers/files/content";
import { PDFContent } from "./pdfExtractor";

interface Chunk {
    content: string;
    pageNumber: number;
    sectionTitle?: string;
    chunkIndex: number;
}


class Chunker {
    //Change to private later on
    public calculateChunkSize(text: string): number {
     const trimmedText = text.trim();
     const words = trimmedText.split(/\s+/);
     const filteredWords = words.filter(word => word.length > 0);
     return filteredWords.length;
    }

    createChunks(text: PDFContent) {
       const chunks: Chunk[] = [];
    const maxChunkSize = 1000; // words
    let chunkIndex = 0;

    for (let sectionIndex = 0; sectionIndex < text.text.length; sectionIndex++) {
        const sectionText = text.text[sectionIndex];
        const wordCount = this.calculateChunkSize(sectionText);
        
        // Extract section title (first line)
        const sectionTitle = sectionText.split('\n')[0].trim();
        
        // Is section small enough? Just use it as-is!
        if (wordCount <= maxChunkSize) {
            chunks.push({
                content: sectionText,
                pageNumber: Math.floor((sectionIndex / text.text.length) * (text.metadata.pages || 1)) + 1,
                sectionTitle: sectionTitle,
                chunkIndex: chunkIndex++
            });
        } else {
            // Section is too big - split it by paragraphs
            const paragraphs = sectionText.split('\n\n');
            let currentChunk = '';
            let currentWordCount = 0;
            
            for (const paragraph of paragraphs) {
                const paragraphWordCount = this.calculateChunkSize(paragraph);
                
                // Will adding this paragraph make chunk too big?
                if (currentWordCount + paragraphWordCount > maxChunkSize && currentChunk.length > 0) {
                    // Save current chunk
                    chunks.push({
                        content: currentChunk.trim(),
                        pageNumber: Math.floor((sectionIndex / text.text.length) * (text.metadata.pages || 1)) + 1,
                        sectionTitle: sectionTitle,
                        chunkIndex: chunkIndex++
                    });
                    
                    // Start new chunk with this paragraph
                    currentChunk = paragraph;
                    currentWordCount = paragraphWordCount;
                } else {
                    // Add paragraph to current chunk
                    currentChunk += '\n\n' + paragraph;
                    currentWordCount += paragraphWordCount;
                }
            }
            
            // Don't forget the last chunk!
            if (currentChunk.length > 0) {
                chunks.push({
                    content: currentChunk.trim(),
                    pageNumber: Math.floor((sectionIndex / text.text.length) * (text.metadata.pages || 1)) + 1,
                    sectionTitle: sectionTitle,
                    chunkIndex: chunkIndex++
                });
            }
        }
    }
    
    return chunks;


    }
}

export default Chunker;
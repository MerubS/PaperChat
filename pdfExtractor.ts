import * as fs from "fs";
import { PDFParse } from "pdf-parse";
import { text } from "stream/consumers";

interface PDFMetadata {
    title?: string;
    keywords?: string[];
    publishedDate?: string;
    pages?: number;
}

interface PDFContent {
    metadata: PDFMetadata;
    text: string[];
}

// Do proper error handling
// Check for valid PDF use header 
class PDFExtractor {
    metadata: PDFMetadata = {};
    content: PDFContent = { metadata: {}, text: [] };

    public printPDF(): void {
        console.log(this.content);
    }

    async extractMetadata(filePath: string) {
        try {
            console.log("File path: " + filePath);
            const fileBuffer = fs.readFileSync(filePath);
            const parser = new PDFParse({ data: fileBuffer });
            const data = await parser.getInfo();

            let title = data.info.title;
            const titleLines: string[] = [];
            const textResult = await parser.getText();

            if (!title || title.match(/paper title/i)) {
                for (const line of textResult.text.split("\n")) {
                    const words = line.split(" ");
                    const isLikelyAuthor =
                        words.length <= 2 &&
                        words.every((word) => /^[A-Z][a-z]+$/.test(word));
                    if (
                        isLikelyAuthor ||
                        line.includes("@") ||
                        /University|Institute|College|School/i.test(line)
                    ) {
                        break;
                    }
                    titleLines.push(line);
                }
                // console.log("Extracted title from text: " + titleLines.join(" "));
            }

            let keywordsLines: string[] = [];
            let capture = false;
            for (const line of textResult.text.split("\n")) {
                if (/Keywords/i.test(line)) {
                    capture = true;
                    // If keywords are on the same line after a dash/colon
                    const sameLineMatch = line.match(/Keywords\s*[—:-]\s*(.+)/i);
                    if (sameLineMatch) {
                        keywordsLines.push(sameLineMatch[1] + "\n");
                    }
                    continue; // move to next line
                }

                if (capture) {
                    // Stop conditions
                    const isSectionHeader = /^[IVXLC0-9]+\.\s+/.test(line); // e.g., I. INTRODUCTION
                    const isEmpty = line.length === 0;
                    const isACMReference = /References|REFERENCES|ACM Reference Format/i.test(line);

                    if (isSectionHeader || isEmpty || isACMReference) break;

                    // Add line (preserve line breaks)
                    keywordsLines.push(line + "\n");
                }
            }
            //console.log("Extracted keywords: " + keywordsLines.join(" ").split(/[,;]/).map(k => k.trim()).filter(Boolean));

            this.metadata = {
                title: titleLines.join(" "),
                keywords: keywordsLines.join(" ").split(/[,;]/).map(k => k.trim()).filter(Boolean),
                publishedDate: data.info.CreationDate,
                pages: data.total,
            };
        } catch (error) {
            throw new Error("Error reading file: " + error);
        }
    }

    //Cleans the context
    async readPdf(filePath: string) {
        try {
            const fileBuffer = fs.readFileSync(filePath);
            const parser = new PDFParse({ data: fileBuffer });
            const textResult = await parser.getText();
           // console.log(textResult.text);
            let sections = [];
            let currentSection = null;
            const sectionHeaderRegex = /^([IVXLC0-9]+\.\s*)?(Abstract|Keywords|Introduction|Background|Related Work|Literature Review|Methodology|Methods|Materials and Methods|Results|Findings|Discussion|Analysis|Conclusion|Conclusions|Future Work|References|Acknowledgments?|Appendix)\b/i;
            const pageMarkerRegex = /^--\s*\d+\s+of\s+\d+\s*--$/i;
            for (const line of textResult.text.split("\n")) {
                const trimmed = line.trim();
                if (pageMarkerRegex.test(trimmed)) continue;
                if (sectionHeaderRegex.test(trimmed)) {
                    // When a new section starts, push the previous one (if exists)
                    if (currentSection) sections.push(currentSection.trim());
                    // Start new section
                    currentSection = trimmed + "\n";
                } else {
                    if (currentSection !== null) {
                        // Add line to current section
                        currentSection += trimmed + " ";
                    }
                }
            }
            if (currentSection) sections.push(currentSection.trim());
            this.content = {
                text: sections,
                metadata: this.metadata,
            };
        } catch (error) {
            throw new Error("File not found:" + error);
        }
    }
}

export { PDFExtractor };

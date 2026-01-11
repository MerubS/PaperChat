import Chunker from "./chunker";
import { PDFExtractor } from "./pdfExtractor";
import * as path from "path";

async function main() {
    const pdfExtract = new PDFExtractor();
    const chunks = new Chunker();
    const pdfPath = path.join(__dirname, "sample2.pdf");
    await pdfExtract.extractMetadata(pdfPath);
    await pdfExtract.readPdf(pdfPath);
    pdfExtract.printPDF();
    console.log(chunks.createChunks(pdfExtract.content));
    // console.log(pdfExtract.content.text[1]);
    // console.log(chunks.calculateChunkSize(pdfExtract.content.text[1]));

}

main();

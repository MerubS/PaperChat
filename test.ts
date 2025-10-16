import { PDFExtractor } from "./pdfExtractor";
import * as path from "path";

async function main() {
    const pdfExtract = new PDFExtractor();
      const pdfPath = path.join(__dirname, "sample2.pdf");
   await pdfExtract.extractMetadata(pdfPath);
await pdfExtract.readPdf(pdfPath);
    pdfExtract.printPDF();
}

main();

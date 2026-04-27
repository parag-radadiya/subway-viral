const fs = require('fs');
const PDFParser = require("pdf2json");

const pdfParser = new PDFParser(this, 1);
pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
pdfParser.on("pdfParser_dataReady", pdfData => {
    fs.writeFileSync("./out.txt", pdfParser.getRawTextContent());
});
pdfParser.loadPDF("../resourse/Weekly Printed Payroll Report (1).PDF");

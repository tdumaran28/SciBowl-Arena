/**
 * Client-side text extraction from PDF and DOCX files.
 * Returns a plain string of the full document text.
 */

export async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return extractPDF(file);
  if (ext === 'docx') return extractDOCX(file);
  throw new Error(`Unsupported file type: ${ext}`);
}

async function extractPDF(file) {
  const pdfjsLib = await import('pdfjs-dist');
  // Point worker at the bundled worker asset (emitted by the bundler)
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Items are individual text chunks; join with spaces, add newline at end of page
    const pageText = content.items.map(item => item.str).join(' ');
    pageTexts.push(pageText);
  }

  return pageTexts.join('\n');
}

async function extractDOCX(file) {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}
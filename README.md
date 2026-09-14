# ContractHero PDF Text Extraction

A small React, TypeScript and Vite application that extracts and displays embedded text from PDF files using `pdfjs-dist`.

## Run locally

```sh
npm install
npm run dev
```

## Other commands

```sh
npm test
npm run build
npm run lint
```

## Technical approach

The PDF is processed directly in the browser because the requirement only needs text extraction and display.

This keeps the implementation small and avoids backend infrastructure or transmitting the document to a server.

React manages the upload, loading, error, and result states. PDF.js was chosen because it reads embedded PDF text in the browser. Documents are not uploaded or stored, and extracted content is rendered as plain text.

## Behaviour

- Select a PDF up to 25 MB.
- Extracted text is displayed after processing.
- Selecting another PDF replaces the previous result.
- Invalid, damaged, or password-protected PDFs show a user-friendly error.
- Mixed PDFs keep available text and warn about pages that may need OCR.

## Limitations

Scanned or image-only pages do not contain embedded text, so text inside them requires OCR. OCR is outside the scope of this implementation. A small helper flags pages with no embedded text and likely scanned pages when an image is present but selectable text appears only in the page margins.

PNG and JPEG files are not accepted because this application processes PDFs only.

Text follows PDF.js reading order, so complex tables and multi-column layouts may not preserve their original visual structure.

## Testing

Tests use Node's built-in test runner and the TypeScript compiler. PDF.js is mocked so the tests focus on our extraction logic.

They cover:

- valid multi-page PDF text returned in order
- non-PDF input rejected
- no extractable text handled
- parser failure shown as a friendly error

For a quick browser check, run:

```sh
npm run dev
```

Then try a normal text PDF, a multi-page PDF, a mixed PDF, a damaged PDF, and an image-only PDF.

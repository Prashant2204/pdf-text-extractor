# PDF Text Extraction

A small React, TypeScript and Vite app that extracts text from PDF files and displays it in the browser. Pages without usable embedded text are sent through an OCR fallback.

## Run locally

```sh
npm install
npm run dev
```

Other useful commands:

```sh
npm test
npm run build
npm run lint
```

## Technical choices

- React manages the upload, loading, error and result states.
- Vite provides the development server and production build.
- PDF.js extracts normal PDF text in the browser, so files are not sent to a backend.
- Tesseract.js OCRs pages that do not contain meaningful embedded body text. It supports English and German.

## Behaviour

- Accepts PDF files up to 25 MB.
- Keeps text from all pages in their original order.
- Mixed PDFs combine PDF.js text and OCR text.
- Failed OCR is non-blocking: available text is shown and affected pages are listed in a warning.
- Invalid, damaged or password-protected PDFs show a readable error.

## Testing

The Node test runner checks multi-page ordering, invalid input, empty text, parser errors, OCR fallback, worker reuse and OCR startup failure. PDF.js and Tesseract.js are mocked so the tests focus on application logic.

## Limitations

OCR can be slow or inaccurate on poor-quality scans. Pages that contain some embedded body text alongside an image may not trigger OCR. Complex tables and multi-column layouts may not preserve their visual structure. PNG and JPEG files are not accepted directly.

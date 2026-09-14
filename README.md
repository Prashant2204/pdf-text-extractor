# ContractHero PDF Text Extraction

A small React, TypeScript and Vite application that extracts text from PDFs using PDF.js, with Tesseract.js as an OCR fallback for scanned pages.

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

- React and Vite keep the UI and its loading, error and result states simple.
- PDF.js extracts embedded text directly in the browser without uploading or storing the document.
- Tesseract.js handles pages without meaningful embedded text. OCR runs only when needed and one worker is reused for the document.
- Tests cover the main extraction flow, errors, OCR fallback, worker reuse and cleanup.

## Limitations

- OCR supports English and German and may be slower or less accurate on poor-quality scans.
- Scanned content may be missed when a page also contains meaningful embedded body text.
- Complex PDF layouts may not preserve their original visual structure.

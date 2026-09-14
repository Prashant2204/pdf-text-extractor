import type { ExtractionResult } from '../services/pdfTextExtractor'

export function TextOutput({ text, pagesWithoutBodyText }: ExtractionResult) {
  return (
    <section className="output-panel" aria-label="Extracted text">
      {pagesWithoutBodyText.length > 0 && (
        <p role="status" className="warning">
          No body text could be extracted from pages: {pagesWithoutBodyText.join(', ')}.
          {' '}These pages may be scanned or image-based and may require OCR, which this tool does not include.
        </p>
      )}
      {text ? (
        <pre tabIndex={0}>{text}</pre>
      ) : (
        <p className="empty-message">No embedded text was found in this PDF.</p>
      )}
    </section>
  )
}

import type { ExtractionResult } from '../services/pdfTextExtractor'

export function TextOutput({ text, pagesWithoutBodyText }: ExtractionResult) {
  return (
    <section className="output-panel" aria-label="Extracted text">
      {pagesWithoutBodyText.length > 0 && (
        <p role="status" className="warning">
          OCR failed or found no text on pages: {pagesWithoutBodyText.join(', ')}.
          {text && ' Any available text is shown below.'}
        </p>
      )}
      {text ? (
        <pre tabIndex={0}>{text}</pre>
      ) : pagesWithoutBodyText.length === 0 && (
        <p role="status" className="empty-message">No text could be extracted from this PDF.</p>
      )}
    </section>
  )
}

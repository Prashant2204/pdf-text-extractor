import { formatBoxes } from './layout.js'

export const MAX_PDF_BYTES = 25 * 1024 * 1024
export const OCR_LANGUAGES = ['eng', 'deu']

export type ExtractedPage = {
  page_number: number
  method: 'embedded' | 'ocr' | 'none'
  text: string
  paragraphs: string[]
  warnings: string[]
}
export type OcrResult = { text: string; paragraphs: string[]; confidence?: number }

// Structural types keep this core independent of PDF.js versions and runtimes.
type TextItem = { str: string; transform: number[]; width: number }
export interface PdfPage {
  getViewport(options: { scale: number }): {
    width: number; height: number
    convertToViewportPoint(x: number, y: number): number[]
  }
  streamTextContent(): ReadableStream<{ items: (TextItem | { type: string })[] }>
  getOperatorList(): Promise<{ fnArray: number[] }>
  cleanup(): unknown
}

export function renderScale(width: number, height: number, maxScale: number, maxPixels: number) {
  return Math.min(maxScale, Math.sqrt(maxPixels / (width * height)))
}

async function readEmbedded(page: PdfPage, imageOperations: readonly number[]) {
  const viewport = page.getViewport({ scale: 1 })
  const items: (TextItem | { type: string })[] = []
  // Explicit reader retains the browser's Safari compatibility.
  const reader = page.streamTextContent().getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      items.push(...value.items)
    }
  } finally {
    reader.releaseLock()
  }
  let bodyCharacters = 0
  let rotated = false
  const boxes = items.flatMap(item => {
    if (!('str' in item)) return []
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    const height = Math.max(1, Math.hypot(item.transform[2], item.transform[3]))
    if (y > viewport.height * 0.05 && y < viewport.height * 0.95) bodyCharacters += item.str.trim().length
    if (Math.abs(item.transform[1]) > 0.1 || Math.abs(item.transform[2]) > 0.1) rotated = true
    return [{ text: item.str, x, y, width: item.width, height }]
  })
  let needsOcr = bodyCharacters === 0
  const warnings: string[] = []
  if (!needsOcr && bodyCharacters < 40) {
    try {
      const operators = await page.getOperatorList()
      needsOcr = operators.fnArray.some(op => imageOperations.includes(op))
    } catch {
      // Image inspection is optional: retain text if both it and OCR fail.
      needsOcr = true
      warnings.push('Page images could not be inspected; OCR was attempted.')
    }
  }
  return { ...formatBoxes(boxes), needsOcr, rotated, warnings }
}

export async function extractDocument<Page extends PdfPage>(
  pdf: { numPages: number; getPage(pageNumber: number): Promise<Page> },
  ocr: { recognize(page: Page): Promise<OcrResult>; close(): Promise<void> },
  imageOperations: readonly number[],
) {
  const pages: ExtractedPage[] = []
  const pagesWithOcrIssues: number[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      try {
        const result: ExtractedPage = { page_number: pageNumber, method: 'none', text: '', paragraphs: [], warnings: [] }
        let needsOcr = true
        try {
          const embedded = await readEmbedded(page, imageOperations)
          result.text = embedded.text
          result.paragraphs = embedded.paragraphs
          result.method = embedded.text ? 'embedded' : 'none'
          needsOcr = embedded.needsOcr
          result.warnings.push(...embedded.warnings)
          if (embedded.rotated) result.warnings.push('Rotated text may have imperfect reading order.')
        } catch {
          result.warnings.push('Embedded text extraction failed; OCR was attempted.')
        }
        if (needsOcr) {
          try {
            const recognized = await ocr.recognize(page)
            if (recognized.text) {
              result.text = recognized.text
              result.paragraphs = recognized.paragraphs
              result.method = 'ocr'
              if (recognized.confidence !== undefined && recognized.confidence < 70) {
                result.warnings.push('OCR confidence is low; check the extracted text against the PDF.')
              }
            } else {
              result.warnings.push('OCR found no readable text. Any embedded text was retained.')
              if (!result.text) result.method = 'ocr'
              pagesWithOcrIssues.push(pageNumber)
            }
          } catch (error) {
            result.warnings.push(error instanceof Error && error.message.startsWith('OCR')
              ? error.message : 'OCR failed. Embedded text, if any, was retained.')
            pagesWithOcrIssues.push(pageNumber)
          }
        }
        pages.push(result)
      } finally {
        page.cleanup()
      }
    }
    return {
      result: {
        text: pages.map(page => page.text).filter(Boolean).join('\n\n'),
        page_count: pdf.numPages,
        pages_without_text: pages.filter(page => !page.text).map(page => page.page_number),
        pages,
        warnings: pages.flatMap(page => page.warnings.map(warning => `Page ${page.page_number}: ${warning}`)),
      },
      // Browser's existing warning field includes OCR failures even if headers remain.
      pagesWithOcrIssues,
    }
  } finally {
    await ocr.close()
  }
}

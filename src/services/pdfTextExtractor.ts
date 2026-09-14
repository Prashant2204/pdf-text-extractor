import { getDocument, GlobalWorkerOptions, OPS, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type ExtractionResult = { text: string; pagesWithoutBodyText: number[] }

export async function extractPdfText(file: File): Promise<ExtractionResult> {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
    throw new Error('Please select a PDF file.')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('Please select a PDF smaller than 25 MB.')
  }

  let loadingTask: ReturnType<typeof getDocument> | undefined
  try {
    loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    const pdf = await loadingTask.promise
    const pages: string[] = []
    const pagesWithoutBodyText: number[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map((item) => 'str' in item
        ? item.str + (item.hasEOL ? '\n' : ' ')
        : '').join('').trim()
      if (!text || await isLikelyScannedPage(page, content)) {
        pagesWithoutBodyText.push(pageNumber)
      }
      pages.push(text)
      page.cleanup()
    }
    return { text: pages.filter(Boolean).join('\n\n').trim(), pagesWithoutBodyText }
  } catch (error) {
    throw new Error("We couldn't process this PDF. It may be damaged or password-protected.", { cause: error })
  } finally {
    await loadingTask?.destroy()
  }
}

// A printed screenshot can have selectable headers/footers but an image-only body.
async function isLikelyScannedPage(
  page: PDFPageProxy,
  content: Awaited<ReturnType<PDFPageProxy['getTextContent']>>,
): Promise<boolean> {
  const viewport = page.getViewport({ scale: 1 })
  const hasBodyText = content.items.some((item) => {
    if (!('str' in item) || !item.str.trim()) return false
    const [, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    // Ignore the top and bottom 5% when looking for body text.
    return y > viewport.height * 0.05 && y < viewport.height * 0.95
  })
  if (hasBodyText) return false

  const operations = await page.getOperatorList()
  return operations.fnArray.some((operation) =>
    operation === OPS.paintImageXObject || operation === OPS.paintInlineImageXObject,
  )
}

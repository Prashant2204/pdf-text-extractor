import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createWorker, type Worker } from 'tesseract.js'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type ExtractionResult = { text: string; pagesWithoutBodyText: number[] }
type TextItems = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items']

export async function extractPdfText(file: File): Promise<ExtractionResult> {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
    throw new Error('Please select a PDF file.')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('Please select a PDF smaller than 25 MB.')
  }

  let loadingTask: ReturnType<typeof getDocument> | undefined
  let ocrWorker: Worker | undefined
  let ocrStartup: Promise<Worker> | undefined
  try {
    loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    const pdf = await loadingTask.promise
    const pages: string[] = []
    const pagesWithoutBodyText: number[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const items = await readTextItems(page)
      let text = items.map((item) => 'str' in item
        ? item.str + (item.hasEOL ? '\n' : ' ')
        : '').join('').trim()
      if (!hasBodyText(page, items)) {
        const canvas = document.createElement('canvas')
        try {
          // Cache the promise: a failed startup stays failed for this PDF.
          if (!ocrStartup) ocrStartup = startOcrWorker()
          ocrWorker = await ocrStartup
          // Render only this page, at up to 2x resolution (capped at 4M pixels).
          const size = page.getViewport({ scale: 1 })
          const scale = Math.min(2, Math.sqrt(4_000_000 / (size.width * size.height)))
          const viewport = page.getViewport({ scale })
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await page.render({ canvas, viewport }).promise
          const { data } = await ocrWorker.recognize(canvas)
          // OCR includes headers/footers, so replace rather than duplicate them.
          const ocrText = data.text.trim()
          if (ocrText) text = ocrText
          else pagesWithoutBodyText.push(pageNumber)
        } catch {
          // Keep other pages and any embedded text if OCR is unavailable.
          pagesWithoutBodyText.push(pageNumber)
        } finally {
          canvas.width = canvas.height = 0
        }
      }
      pages.push(text)
      page.cleanup()
    }
    return { text: pages.filter(Boolean).join('\n\n'), pagesWithoutBodyText }
  } catch (error) {
    throw new Error("We couldn't process this PDF. It may be damaged or password-protected.", { cause: error })
  } finally {
    try {
      await ocrWorker?.terminate()
    } finally {
      await loadingTask?.destroy()
    }
  }
}

// Tesseract can report startup errors without rejecting createWorker's promise.
function startOcrWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    createWorker(['eng', 'deu'], undefined, {
      workerPath: ocrWorkerUrl,
      errorHandler: reject,
    }).then(resolve, reject)
  })
}

// Read text chunks explicitly for Safari compatibility.
async function readTextItems(page: PDFPageProxy) {
  const reader = page.streamTextContent().getReader()
  const items: TextItems = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return items
      items.push(...value.items)
    }
  } finally {
    reader.releaseLock()
  }
}

// A printed screenshot can have selectable headers/footers but an image-only body.
function hasBodyText(page: PDFPageProxy, items: TextItems): boolean {
  const viewport = page.getViewport({ scale: 1 })
  return items.some((item) => {
    if (!('str' in item) || !item.str.trim()) return false
    const [, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    // Ignore the top and bottom 5% when looking for body text.
    return y > viewport.height * 0.05 && y < viewport.height * 0.95
  })
}

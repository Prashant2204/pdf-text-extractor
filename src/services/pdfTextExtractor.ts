import { getDocument, GlobalWorkerOptions, OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url'
import { extractDocument, MAX_PDF_BYTES, OCR_LANGUAGES, renderScale } from '../../mcp/src/shared/extraction.js'
import { formatOcrData } from '../../mcp/src/shared/layout.js'

GlobalWorkerOptions.workerSrc = workerUrl

export type ExtractionResult = { text: string; pagesWithoutBodyText: number[] }

export async function extractPdfText(file: File): Promise<ExtractionResult> {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
    throw new Error('Please select a PDF file.')
  }
  if (file.size > MAX_PDF_BYTES) throw new Error('Please select a PDF smaller than 25 MB.')

  let loadingTask: ReturnType<typeof getDocument> | undefined
  let ocrWorker: Worker | undefined
  let ocrStartup: Promise<Worker> | undefined
  try {
    loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    const pdf = await loadingTask.promise
    const { result, pagesWithOcrIssues } = await extractDocument(pdf, {
      async recognize(page: PDFPageProxy) {
        // Cache startup failure for this PDF; initialize before allocating a canvas.
        if (!ocrStartup) ocrStartup = startOcrWorker()
        ocrWorker = await ocrStartup
        const canvas = document.createElement('canvas')
        try {
          const size = page.getViewport({ scale: 1 })
          const scale = renderScale(size.width, size.height, 2, 4_000_000)
          const viewport = page.getViewport({ scale })
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await page.render({ canvas, viewport }).promise
          const { data } = await ocrWorker.recognize(canvas, {}, { text: true, blocks: true })
          return formatOcrData(data)
        } finally {
          canvas.width = canvas.height = 0
        }
      },
      async close() { await ocrWorker?.terminate() },
    }, [OPS.paintImageXObject, OPS.paintInlineImageXObject])
    // Preserve the React interface and its existing OCR warning semantics.
    return { text: result.text, pagesWithoutBodyText: pagesWithOcrIssues }
  } catch (error) {
    throw new Error("We couldn't process this PDF. It may be damaged or password-protected.", { cause: error })
  } finally {
    await loadingTask?.destroy()
  }
}

// Tesseract can report startup errors without rejecting createWorker's promise.
function startOcrWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    createWorker(OCR_LANGUAGES, undefined, {
      workerPath: ocrWorkerUrl,
      errorHandler: reject,
    }).then(async worker => {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' })
        return worker
      } catch (error) {
        await worker.terminate().catch(() => {})
        throw error
      }
    }).then(resolve, reject)
  })
}

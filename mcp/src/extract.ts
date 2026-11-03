import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getDocument, OPS, VerbosityLevel, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractDocument, MAX_PDF_BYTES, renderScale } from './shared/extraction.js'
import { OcrSession } from './ocr.js'

const require = createRequire(import.meta.url)
const pdfRoot = new URL('./', pathToFileURL(require.resolve('pdfjs-dist/package.json')))

async function renderForOcr(page: PDFPageProxy) {
  const { createCanvas } = await import('@napi-rs/canvas')
  const size = page.getViewport({ scale: 1 })
  const scale = renderScale(size.width, size.height, 2.5, 8_000_000)
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)))
  try {
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise
    return canvas.toBuffer('image/png')
  } finally {
    canvas.width = canvas.height = 1
  }
}

export async function extractPdfText(filePath: string) {
  if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== '.pdf') {
    throw new Error('Provide an absolute local path to a .pdf file.')
  }

  // Non-blocking open also lets us reject named pipes without hanging.
  const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error('PDF file was not found.')
    if (error.code === 'EACCES' || error.code === 'EPERM') throw new Error('PDF file is not readable. Check file permissions.')
    throw new Error('Could not open the PDF file.')
  })
  let data: Uint8Array
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error('The path must point to a regular PDF file.')
    if (stat.size > MAX_PDF_BYTES) throw new Error('PDF exceeds the 25 MiB size limit.')
    // Bound the read even if the file grows after stat().
    const chunks: Buffer[] = []
    let size = 0
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_PDF_BYTES + 1 - size))
      const { bytesRead } = await file.read(chunk)
      if (!bytesRead) break
      size += bytesRead
      if (size > MAX_PDF_BYTES) throw new Error('PDF exceeds the 25 MiB size limit.')
      chunks.push(chunk.subarray(0, bytesRead))
    }
    const bytes = Buffer.concat(chunks)
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      throw new Error('Invalid PDF: the PDF header is missing.')
    }
    data = new Uint8Array(bytes)
  } finally {
    await file.close()
  }

  const task = getDocument({
    data,
    verbosity: VerbosityLevel.ERRORS,
    cMapUrl: fileURLToPath(new URL('cmaps/', pdfRoot)),
    cMapPacked: true,
    standardFontDataUrl: fileURLToPath(new URL('standard_fonts/', pdfRoot)),
    wasmUrl: fileURLToPath(new URL('wasm/', pdfRoot)),
  })
  try {
    const pdf = await task.promise
    const ocr = new OcrSession()
    const { result } = await extractDocument(pdf, {
      recognize: async page => ocr.recognize(await renderForOcr(page)),
      close: () => ocr.close(),
    }, [OPS.paintImageXObject, OPS.paintInlineImageXObject])
    return { success: true, ...result }
  } catch {
    throw new Error('Could not extract text. The PDF may be invalid, damaged, or password-protected.')
  } finally {
    await task.destroy()
  }
}

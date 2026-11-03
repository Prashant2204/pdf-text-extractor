import { parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import { formatOcrData } from './shared/layout.js'
import { OCR_LANGUAGES } from './shared/extraction.js'

let engine: Worker | undefined
async function getEngine() {
  if (engine) return engine
  // Build copies both models next to this worker. No CDN fallback or cache writes.
  engine = await new Promise<Worker>((resolve, reject) => {
    createWorker(OCR_LANGUAGES, 1, {
      langPath: fileURLToPath(new URL('./tessdata/', import.meta.url)),
      cacheMethod: 'none', logger: () => {}, errorHandler: reject,
    })
      .then(resolve, reject)
  })
  await engine.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' })
  return engine
}

parentPort?.on('message', async (image: Uint8Array) => {
  try {
    const worker = await getEngine()
    const { data } = await worker.recognize(Buffer.from(image), {}, { text: true, blocks: true })
    parentPort?.postMessage(formatOcrData(data))
  } catch {
    // Never send worker diagnostics or document contents into logs.
    parentPort?.postMessage({ error: 'OCR failed. Embedded text, if any, was retained.' })
  }
})

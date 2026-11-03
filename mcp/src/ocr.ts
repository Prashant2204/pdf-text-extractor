import { Worker } from 'node:worker_threads'

import type { OcrResult } from './shared/extraction.js'

// Isolate the engine so startup failures and timeouts can terminate every worker.
// Tesseract startup errors can leave its createWorker promise pending.
export class OcrSession {
  private worker?: Worker
  private failed = false

  async recognize(image: Uint8Array): Promise<OcrResult> {
    if (this.failed) throw new Error('OCR is unavailable for this document after an earlier failure.')
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('./ocr-worker.js', import.meta.url), { stdout: true, stderr: true })
        this.worker.on('error', () => { this.failed = true })
        this.worker.on('exit', () => { this.failed = true })
        // Native/WASM diagnostics must never reach the MCP stdout stream or log PDF contents.
        this.worker.stdout.resume()
        this.worker.stderr.resume()
      }
      const worker = this.worker
      return await new Promise<OcrResult>((resolve, reject) => {
        const finish = (error?: Error, result?: OcrResult) => {
          clearTimeout(timer)
          worker.off('message', onMessage)
          worker.off('error', onError)
          worker.off('exit', onExit)
          if (error) reject(error)
          else resolve(result!)
        }
        const onMessage = (result: OcrResult & { error?: string }) => {
          finish(result.error ? new Error(result.error) : undefined, result)
        }
        const onError = () => finish(new Error('OCR worker failed. Embedded text, if any, was retained.'))
        const onExit = () => finish(new Error('OCR worker stopped unexpectedly.'))
        const timer = setTimeout(() => finish(new Error('OCR exceeded the 60-second page time limit.')), 60_000)
        worker.once('message', onMessage)
        worker.once('error', onError)
        worker.once('exit', onExit)
        worker.postMessage(image)
      })
    } catch (error) {
      this.failed = true
      await this.close()
      throw error
    }
  }

  async close() {
    await this.worker?.terminate()
    this.worker = undefined
  }
}

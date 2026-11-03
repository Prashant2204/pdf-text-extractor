import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractDocument } from '../dist/shared/extraction.js'
import { OcrSession } from '../dist/ocr.js'

test('retains embedded text when image inspection and OCR fail', async () => {
  let cleaned = false
  let closed = false
  const page = {
    getViewport: () => ({ width: 600, height: 800, convertToViewportPoint: (x, y) => [x, 800 - y] }),
    streamTextContent: () => new ReadableStream({ start(controller) {
      controller.enqueue({ items: [{ str: 'Body text', transform: [12, 0, 0, 12, 50, 400], width: 50 }] })
      controller.close()
    } }),
    async getOperatorList() { throw new Error('Unsupported image') },
    cleanup() { cleaned = true },
  }
  const { result, pagesWithOcrIssues } = await extractDocument({ numPages: 1, getPage: async () => page }, {
    async recognize() { throw new Error('OCR unavailable') },
    async close() { closed = true },
  }, [85])
  assert.equal(result.text, 'Body text')
  assert.equal(result.pages[0].method, 'embedded')
  assert.match(result.pages[0].warnings[0], /images could not be inspected/)
  assert.match(result.pages[0].warnings[1], /OCR unavailable/)
  assert.deepEqual(result.pages_without_text, [])
  assert.deepEqual(pagesWithOcrIssues, [1])
  assert.ok(cleaned && closed)
})

test('OCR timeout terminates the worker and prevents retries for that document', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const session = new OcrSession()
  try {
    const pending = assert.rejects(session.recognize(new Uint8Array()), /60-second page time limit/)
    context.mock.timers.tick(60_000)
    await pending
    await assert.rejects(session.recognize(new Uint8Array()), /earlier failure/)
  } finally {
    context.mock.timers.reset()
    await session.close()
  }
})

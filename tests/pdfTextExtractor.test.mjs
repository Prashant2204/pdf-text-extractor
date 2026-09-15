import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test, beforeEach, afterEach } from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import ts from 'typescript'

// Read the real extraction service used by the application.
const source = await readFile(new URL('../src/services/pdfTextExtractor.ts', import.meta.url), 'utf8')

// Convert TypeScript to JavaScript so Node can execute it in the tests.
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})

async function loadExtractor(
  getDocument = () => { throw new Error('Unexpected parser call') },
  createWorker = () => { throw new Error('Unexpected OCR call') },
) {
  // Load the service in isolation and replace PDF.js with a test double.
  const module = new SourceTextModule(outputText)
  await module.link((specifier) => {
    if (specifier === 'pdfjs-dist/legacy/build/pdf.mjs') {
      return new SyntheticModule(['getDocument', 'GlobalWorkerOptions'], function () {
        this.setExport('getDocument', getDocument)
        this.setExport('GlobalWorkerOptions', {})
      })
    }
    if (specifier === 'tesseract.js') {
      return new SyntheticModule(['createWorker'], function () { this.setExport('createWorker', createWorker) })
    }
    return new SyntheticModule(['default'], function () { this.setExport('default', 'worker.mjs') })
  })
  await module.evaluate()
  return module.namespace.extractPdfText
}

// Expose a reader without async iteration, matching the Safari compatibility case.
function textStream(content) {
  const chunks = content.items.map(item => ({ items: [item] }))
  return {
    getReader: () => ({
      async read() {
        return chunks.length ? { value: chunks.shift(), done: false } : { done: true }
      },
      releaseLock() {},
    }),
  }
}

// Minimal viewport mock used when PDF.js renders pages for OCR.
const viewport = ({ scale = 1 } = {}) => ({ width: 600 * scale, height: 800 * scale, convertToViewportPoint: (x, y) => [x, 800 - y] })

// Browser canvas stand-in; PDF.js rendering and OCR are mocked in unit tests.
beforeEach(() => { globalThis.document = { createElement: () => ({ width: 0, height: 0 }) } })
afterEach(() => { delete globalThis.document })

// Create a file-like object for tests; PDF.js itself is mocked.
const pdfFile = () => new File(['PDF bytes'], 'contract.pdf', { type: 'application/pdf' })

// PURPOSE: Reject a non-PDF file before attempting extraction.
test('rejects non-PDF input before invoking PDF.js', async () => {
  const extract = await loadExtractor()
  await assert.rejects(extract(new File(['text'], 'notes.txt')), /Please select a PDF file/)
})

// PURPOSE: Return multi-page text in the correct order and release PDF resources.
test('combines pages in order and cleans up the document', async () => {
  let cleanedPages = 0
  let destroyed = false
  const extract = await loadExtractor(({ data }) => {
    assert.ok(data instanceof Uint8Array)
    return {
      promise: Promise.resolve({
        numPages: 2,
        async getPage(number) {
          return {
            getViewport: viewport,
            streamTextContent: () => textStream({ items: [
              { str: 'Page', transform: [1, 0, 0, 1, 20, 400] },
              { str: `${number}`, hasEOL: true, transform: [1, 0, 0, 1, 60, 400] },
            ] }),
            cleanup() { cleanedPages++ },
          }
        },
      }),
      async destroy() { destroyed = true },
    }
  })
  assert.deepEqual(await extract(pdfFile()), { text: 'Page 1\n\nPage 2', pagesWithoutBodyText: [] })
  assert.equal(cleanedPages, 2)
  assert.equal(destroyed, true)
})

// PURPOSE: Return an empty result and identify pages with no extractable text.
test('returns a page warning when embedded text and OCR are both empty', async () => {
  const extract = await loadExtractor(() => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({
      streamTextContent: () => textStream({ items: [] }), cleanup() {},
      getViewport: viewport, render: () => ({ promise: Promise.resolve() }),
    }) }),
    async destroy() {},
  }), async () => ({ recognize: async () => ({ data: { text: '' } }), terminate: async () => {} }))
  assert.deepEqual(await extract(pdfFile()), { text: '', pagesWithoutBodyText: [1] })
})

// PURPOSE: Show a friendly error when parsing fails and release PDF resources.
test('hides parser details and destroys a failed loading task', async () => {
  let destroyed = false
  const extract = await loadExtractor(() => ({
    promise: Promise.reject(new Error('Private parser details')),
    async destroy() { destroyed = true },
  }))
  await assert.rejects(extract(pdfFile()), { message: "We couldn't process this PDF. It may be damaged or password-protected." })
  assert.equal(destroyed, true)
})

// PURPOSE: OCR only pages without body text, preserving order with one worker.
test('mixed PDF uses one OCR worker and keeps page order without duplicate headers', async () => {
  const rendered = []
  let workers = 0
  let terminated = 0
  let recognized = 0
  const extract = await loadExtractor(() => ({
    promise: Promise.resolve({ numPages: 4, getPage: async (number) => ({
      getViewport: viewport,
      streamTextContent: () => textStream({ items: number === 2 ? [] : [{
        str: number === 3 ? 'Header' : `Page ${number}`,
        hasEOL: true, transform: [1, 0, 0, 1, 20, number === 3 ? 780 : 400],
      }] }),
      render() {
        rendered.push(number)
        return { promise: Promise.resolve() }
      },
      cleanup() {},
    }) }),
    async destroy() {},
  }), async () => {
    workers++
    return {
      async recognize() { return { data: { text: ++recognized === 1 ? 'Scanned page 2' : 'Header\nScanned page 3' } } },
      async terminate() { terminated++ },
    }
  })
  assert.deepEqual(await extract(pdfFile()), {
    text: 'Page 1\n\nScanned page 2\n\nHeader\nScanned page 3\n\nPage 4', pagesWithoutBodyText: [],
  })
  assert.deepEqual(rendered, [2, 3])
  assert.equal(workers, 1)
  assert.equal(terminated, 1)
})

// PURPOSE: Keep embedded text and release the worker when OCR fails.
test('OCR failure returns a page warning and terminates the worker', async () => {
  let terminated = false
  let destroyed = false
  const extract = await loadExtractor(() => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({
      getViewport: viewport,
      streamTextContent: () => textStream({ items: [{ str: 'Header', transform: [1, 0, 0, 1, 20, 780] }] }),
      render: () => ({ promise: Promise.resolve() }), cleanup() {},
    }) }),
    async destroy() { destroyed = true },
  }), async () => ({
    async recognize() { throw new Error('OCR unavailable') },
    async terminate() { terminated = true },
  }))
  assert.deepEqual(await extract(pdfFile()), { text: 'Header', pagesWithoutBodyText: [1] })
  assert.equal(terminated, true)
  assert.equal(destroyed, true)
})

// PURPOSE: Cache startup failure per PDF, warn, and continue without retrying OCR.
test('language download failure does not hang or retry on later pages', { timeout: 2000 }, async () => {
  let attempts = 0
  let destroyed = 0
  const rendered = []
  const extract = await loadExtractor(() => ({
    promise: Promise.resolve({ numPages: 3, getPage: async (number) => ({
      getViewport: viewport,
      streamTextContent: () => textStream({ items: [{
        str: number === 3 ? 'Body text' : `Header ${number}`,
        transform: [1, 0, 0, 1, 20, number === 3 ? 400 : 780],
      }] }),
      render() { rendered.push(number); return { promise: Promise.resolve() } },
      cleanup() {},
    }) }),
    async destroy() { destroyed++ },
  }), (languages, engine, options) => {
    attempts++
    // Reproduce Tesseract's callback-only error while its promise stays pending.
    queueMicrotask(() => options.errorHandler(new Error('Language download failed')))
    return new Promise(() => {})
  })

  const expected = { text: 'Header 1\n\nHeader 2\n\nBody text', pagesWithoutBodyText: [1, 2] }
  assert.deepEqual(await extract(pdfFile()), expected)
  assert.equal(attempts, 1)
  assert.equal(destroyed, 1)
  assert.deepEqual(rendered, [])

  // Selecting another PDF starts a new attempt, rather than caching forever.
  assert.deepEqual(await extract(pdfFile()), expected)
  assert.equal(attempts, 2)
  assert.equal(destroyed, 2)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test, beforeEach, afterEach } from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import ts from 'typescript'
import { makeLayoutPdf } from '../mcp/tests/fixture.mjs'

async function sourceModule(url) {
  const source = await readFile(url, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return new SourceTextModule(outputText, { identifier: url.href })
}

async function loadExtractor(
  getDocument = () => { throw new Error('Unexpected parser call') },
  createWorker = () => { throw new Error('Unexpected OCR call') },
) {
  const module = await sourceModule(new URL('../src/services/pdfTextExtractor.ts', import.meta.url))
  const modules = new Map()
  await module.link(async (specifier, parent) => {
    if (specifier.startsWith('.')) {
      const url = new URL(specifier.replace(/\.js$/, '.ts'), parent.identifier)
      if (!modules.has(url.href)) modules.set(url.href, await sourceModule(url))
      return modules.get(url.href)
    }
    if (specifier === 'pdfjs-dist/legacy/build/pdf.mjs') {
      return new SyntheticModule(['getDocument', 'GlobalWorkerOptions', 'OPS'], function () {
        this.setExport('getDocument', options => {
          const task = getDocument(options)
          return { ...task, destroy: () => task.destroy(), promise: task.promise.then(pdf => ({
            numPages: pdf.numPages,
            async getPage(number) {
              const page = await pdf.getPage(number)
              // Existing mocks represent text-only pages unless specified otherwise.
              page.getOperatorList ??= async () => ({ fnArray: [] })
              return page
            },
          })) }
        })
        this.setExport('GlobalWorkerOptions', {})
        this.setExport('OPS', { paintImageXObject: 85, paintInlineImageXObject: 86 })
      })
    }
    if (specifier === 'tesseract.js') {
      return new SyntheticModule(['createWorker', 'PSM'], function () {
        this.setExport('createWorker', async (...args) => {
          const worker = await createWorker(...args)
          worker.setParameters ??= async () => ({})
          return worker
        })
        this.setExport('PSM', { AUTO: '3' })
      })
    }
    return new SyntheticModule(['default'], function () { this.setExport('default', 'worker.mjs') })
  })
  await module.evaluate()
  return module.namespace.extractPdfText
}

// Expose a reader without async iteration, matching the Safari compatibility case.
function textStream(content) {
  const chunks = content.items.map(item => ({ items: [{ width: item.str?.length * 6, ...item }] }))
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
              { str: 'Page', transform: [12, 0, 0, 12, 20, 400] },
              { str: `${number}`, hasEOL: true, transform: [12, 0, 0, 12, 60, 400] },
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
        hasEOL: true, transform: [12, 0, 0, 12, 20, number === 3 ? 780 : 400],
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
      streamTextContent: () => textStream({ items: [{ str: 'Header', transform: [12, 0, 0, 12, 20, 780] }] }),
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
        transform: [12, 0, 0, 12, 20, number === 3 ? 400 : 780],
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

test('browser adapter formats a real PDF with the shared reading-order and table rules', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const extract = await loadExtractor(options => getDocument({ ...options, useSystemFonts: true }))
  const result = await extract(new File([makeLayoutPdf()], 'layout.pdf', { type: 'application/pdf' }))
  assert.deepEqual(result, { text: 'Item | Amount\n\nApples | 10 EUR', pagesWithoutBodyText: [] })
})

test('sparse embedded body text over an image triggers shared OCR fallback', async () => {
  let parameters
  let outputs
  const extract = await loadExtractor(() => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({
      getViewport: viewport,
      streamTextContent: () => textStream({ items: [{ str: 'Label', transform: [12, 0, 0, 12, 20, 400] }] }),
      getOperatorList: async () => ({ fnArray: [85] }),
      render: () => ({ promise: Promise.resolve() }), cleanup() {},
    }) }),
    async destroy() {},
  }), async () => ({
    async setParameters(value) { parameters = value },
    async recognize(canvas, options, output) {
      outputs = output
      return { data: { text: 'fallback', blocks: [{ paragraphs: [{ lines: [{ words: [
        { text: 'OCR', bbox: { x0: 20, y0: 20, x1: 45, y1: 32 } },
        { text: 'table', bbox: { x0: 200, y0: 20, x1: 240, y1: 32 } },
      ] }] }] }] } }
    },
    async terminate() {},
  }))
  assert.deepEqual(await extract(pdfFile()), { text: 'OCR | table', pagesWithoutBodyText: [] })
  assert.deepEqual(parameters, { tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' })
  assert.deepEqual(outputs, { text: true, blocks: true })
})

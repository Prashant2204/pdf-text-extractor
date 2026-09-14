import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import ts from 'typescript'

// Read the real extraction service used by the application.
const source = await readFile(new URL('../src/services/pdfTextExtractor.ts', import.meta.url), 'utf8')

// Convert TypeScript to JavaScript so Node can execute it in the tests.
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})

async function loadExtractor(getDocument = () => { throw new Error('Unexpected parser call') }) {
  
  // Load the service in isolation and replace PDF.js with a test double.
  const module = new SourceTextModule(outputText)
  await module.link((specifier) => specifier === 'pdfjs-dist'
    // Supply only the PDF.js exports used by the extraction service.
    ? new SyntheticModule(['getDocument', 'GlobalWorkerOptions', 'OPS'], function () {
        this.setExport('getDocument', getDocument)
        this.setExport('GlobalWorkerOptions', {})
        this.setExport('OPS', { paintImageXObject: 85, paintInlineImageXObject: 86 })
      })
    : new SyntheticModule(['default'], function () { this.setExport('default', 'worker.mjs') }))
  await module.evaluate()
  return module.namespace.extractPdfText
}

// Provide predictable page coordinates for scanned-page detection tests.
const viewport = () => ({ height: 800, convertToViewportPoint: (x, y) => [x, 800 - y] })

// Create a file-like object for tests; PDF.js itself is mocked.
const pdfFile = () => new File(['PDF bytes'], 'contract.pdf', { type: 'application/pdf' })

// PURPOSE: Reject a non-PDF file before attempting extraction.
test('rejects non-PDF input before invoking PDF.js', async () => {
  const extract = await loadExtractor()
  await assert.rejects(extract(new File(['text'], 'notes.txt')), /Please select a PDF file/)
})

// PURPOSE: Return multi-page text in the correct order and release PDF resources.
test('combines pages in order and cleans up the document', async () => {
  const requestedPages = []
  let cleanedPages = 0
  let destroyed = false
  const extract = await loadExtractor(({ data }) => {
    assert.ok(data instanceof Uint8Array)
    return {
      promise: Promise.resolve({
        numPages: 2,
        async getPage(number) {
          requestedPages.push(number)
          return {
            getViewport: viewport,
            getTextContent: async () => ({ items: [{ str: `Page ${number}`, hasEOL: true, transform: [1, 0, 0, 1, 20, 400] }] }),
            cleanup() { cleanedPages++ },
          }
        },
      }),
      async destroy() { destroyed = true },
    }
  })
  assert.deepEqual(await extract(pdfFile()), { text: 'Page 1\n\nPage 2', pagesWithoutBodyText: [] })
  assert.deepEqual(requestedPages, [1, 2])
  assert.equal(cleanedPages, 2)
  assert.equal(destroyed, true)
})

// PURPOSE: Return an empty result and identify pages with no extractable text.
test('returns empty text for a PDF without a text layer', async () => {
  const extract = await loadExtractor(() => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({
      getTextContent: async () => ({ items: [] }), cleanup() {},
    }) }),
    async destroy() {},
  }))
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

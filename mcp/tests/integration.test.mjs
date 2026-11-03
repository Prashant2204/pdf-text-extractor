import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createCanvas } from '@napi-rs/canvas'
import { makePdf, makeDocument, makeLayoutPdf } from './fixture.mjs'

// Set MCP_TEST_CLI to exercise the installed tarball's actual executable.
const cli = process.env.MCP_TEST_CLI || fileURLToPath(new URL('../dist/index.js', import.meta.url))

test('real STDIO client extracts embedded, English/German scanned and mixed PDFs safely', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-mcp-test-'))
  const transport = new StdioClientTransport({
    command: process.env.MCP_TEST_CLI ? cli : process.execPath,
    args: process.env.MCP_TEST_CLI ? [] : [cli], cwd: directory, stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr += chunk })
  const client = new Client({ name: 'pdf-integration-test', version: '1.0.0' })
  const protocolErrors = []
  client.onerror = error => { protocolErrors.push(error) }
  let unreadable
  try {
    const valid = join(directory, 'sample.PDF')
    const original = makePdf()
    await writeFile(valid, original)
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(tool => tool.name), ['extract_pdf_text'])
    assert.deepEqual(tools[0].inputSchema.required, ['file_path'])
    assert.ok(tools[0].outputSchema.properties.pages, 'page-level results must be discoverable in the output schema')
    const capabilities = client.getServerCapabilities()
    assert.ok(!capabilities.resources)
    assert.ok(!capabilities.prompts)

    async function call(file_path) {
      const result = await client.callTool({ name: 'extract_pdf_text', arguments: { file_path } })
      const data = JSON.parse(result.content[0].text)
      assert.deepEqual(result.structuredContent, data)
      assert.equal(Boolean(result.isError), !data.success)
      return data
    }
    const extracted = await call(valid)
    assert.equal(extracted.success, true)
    assert.equal(extracted.text, 'Hello from MCP\n\nSecond page')
    assert.equal(extracted.page_count, 2)
    assert.deepEqual(extracted.pages_without_text, [])
    assert.deepEqual(extracted.warnings, [])
    assert.deepEqual(extracted.pages, [
      { page_number: 1, method: 'embedded', text: 'Hello from MCP', paragraphs: ['Hello from MCP'], warnings: [] },
      { page_number: 2, method: 'embedded', text: 'Second page', paragraphs: ['Second page'], warnings: [] },
    ])
    assert.deepEqual(await readFile(valid), original)
    const layout = join(directory, 'layout.pdf')
    await writeFile(layout, makeLayoutPdf())
    const formatted = await call(layout)
    assert.equal(formatted.text, 'Item | Amount\n\nApples | 10 EUR')
    assert.deepEqual(formatted.pages[0].paragraphs, ['Item | Amount', 'Apples | 10 EUR'])
    const empty = join(directory, 'empty.pdf')
    await writeFile(empty, makePdf(['']))
    const blank = await call(empty)
    assert.equal(blank.success, true)
    assert.equal(blank.text, '')
    assert.deepEqual(blank.pages_without_text, [1])
    assert.equal(blank.pages[0].method, 'ocr')
    assert.match(blank.pages[0].warnings[0], /no readable text/)

    const canvas = createCanvas(1224, 1584)
    const context = canvas.getContext('2d')
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'black'
    context.font = '40px sans-serif'
    context.fillText('English scanned document', 100, 260)
    context.fillText('Deutscher Text mit Umlauten', 100, 340)
    context.fillText('Größe und Prüfung', 100, 420)
    const scan = { image: canvas.toBuffer('image/jpeg'), width: canvas.width, height: canvas.height }
    const mixed = join(directory, 'mixed.pdf')
    await writeFile(mixed, makeDocument([
      { content: 'BT /F1 12 Tf 50 700 Td (Embedded first page) Tj ET' },
      { ...scan, content: 'BT /F1 12 Tf 50 780 Td (Selectable header) Tj ET' },
      scan,
    ]))
    const ocrResult = await call(mixed)
    assert.deepEqual(ocrResult.pages.map(page => page.method), ['embedded', 'ocr', 'ocr'])
    assert.deepEqual(ocrResult.pages.map(page => page.page_number), [1, 2, 3])
    assert.deepEqual(ocrResult.pages_without_text, [])
    for (const page of ocrResult.pages.slice(1)) {
      assert.match(page.text, /English scanned document/i)
      assert.match(page.text, /Deutscher Text mit Umlauten/i)
      assert.match(page.text, /Größe und Prüfung/i)
      assert.ok(page.paragraphs.length > 0)
      assert.equal(page.text, page.paragraphs.join('\n\n'))
    }
    assert.equal(ocrResult.text, ocrResult.pages.map(page => page.text).join('\n\n'))
    assert.ok(!stderr.includes('English scanned document'))
    const entries = await readdir(directory)
    assert.ok(!entries.some(name => /traineddata|\.png$/.test(name)), 'OCR must not create model caches or render files')

    const bad = join(directory, 'bad.pdf')
    await writeFile(bad, 'not a PDF')
    const damaged = join(directory, 'damaged.pdf')
    await writeFile(damaged, '%PDF-1.7\ninvalid objects')
    const oversized = join(directory, 'large.pdf')
    const large = await open(oversized, 'w')
    await large.truncate(25 * 1024 * 1024 + 1)
    await large.close()
    const folder = join(directory, 'folder.pdf')
    await mkdir(folder)
    unreadable = join(directory, 'unreadable.pdf')
    await writeFile(unreadable, original)
    await chmod(unreadable, 0)
    for (const [path, message] of [
      ['relative.pdf', /absolute local path/],
      [join(directory, 'notes.txt'), /\.pdf file/],
      [join(directory, 'missing.pdf'), /not found/],
      [bad, /header is missing/],
      [damaged, /invalid, damaged, or password-protected/],
      [oversized, /25 MiB/],
      [folder, /regular PDF file/],
      ...(process.platform !== 'win32' && process.getuid?.() !== 0 ? [[unreadable, /not readable/]] : []),
    ]) {
      const result = await call(path)
      assert.equal(result.success, false)
      assert.equal(result.text, '')
      assert.match(result.error, message)
    }
    const invalid = await client.callTool({ name: 'extract_pdf_text', arguments: { file_path: 42 } })
    assert.equal(invalid.isError, true)
    // A malformed PDF can emit diagnostics; they must not leak contents.
    assert.ok(!stderr.includes('Hello from MCP'))
    // Successful calls after failures confirm that the connection remains usable.
    assert.equal((await call(valid)).success, true)
    assert.deepEqual(protocolErrors, [], 'stdout must contain only valid MCP messages')
  } finally {
    await client.close()
    if (unreadable) await chmod(unreadable, 0o600)
    await rm(directory, { recursive: true, force: true })
  }
})

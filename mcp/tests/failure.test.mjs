import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { makeDocument } from './fixture.mjs'

test('missing OCR assets preserve embedded text, warn, and release workers', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-mcp-no-models-'))
  try {
    // Simulate a broken installation without modifying the actual build.
    const dist = new URL('../dist/', import.meta.url)
    await cp(dist, directory, { recursive: true, filter: source => !source.endsWith('.traineddata.gz') })
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await symlink(fileURLToPath(new URL('../node_modules/', import.meta.url)), join(directory, 'node_modules'), 'junction')
    const path = join(directory, 'partial.pdf')
    await writeFile(path, makeDocument([
      { content: 'BT /F1 12 Tf 50 780 Td (Header retained) Tj ET' },
      {},
      { content: 'BT /F1 12 Tf 50 700 Td (Embedded body survives) Tj ET' },
    ]))
    const { extractPdfText } = await import(pathToFileURL(join(directory, 'extract.js')))
    const result = await extractPdfText(path)
    assert.equal(result.success, true)
    assert.deepEqual(result.pages.map(page => page.method), ['embedded', 'none', 'embedded'])
    assert.equal(result.pages[0].text, 'Header retained')
    assert.match(result.pages[0].warnings[0], /OCR failed/)
    assert.match(result.pages[1].warnings[0], /earlier failure/)
    assert.equal(result.pages[2].text, 'Embedded body survives')
    assert.deepEqual(result.pages_without_text, [2])
    assert.equal(result.warnings.length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

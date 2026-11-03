import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatBoxes } from '../dist/shared/layout.js'

test('orders shuffled chunks by row and preserves readable table gaps', () => {
  const box = (text, x, y, width = 40) => ({ text, x, y, width, height: 12 })
  const result = formatBoxes([
    box('10 EUR', 300, 60), box('Amount', 300, 40),
    box('paragraph.', 75, 120), box('Item', 50, 40), box('Apples', 50, 60),
    box('New', 50, 120, 20),
  ])
  assert.match(result.text, /^Item \| Amount/)
  assert.match(result.text, /Apples \| 10 EUR/)
  assert.equal(result.paragraphs.at(-1), 'New paragraph.')
  assert.ok(result.text.indexOf('Item') < result.text.indexOf('Apples'))
})

test('does not insert spaces between adjacent glyphs or produce empty paragraphs', () => {
  assert.deepEqual(formatBoxes([]), { text: '', paragraphs: [] })
  assert.equal(formatBoxes([
    { text: 'Hel', x: 0, y: 20, width: 15, height: 12 },
    { text: 'lo', x: 15, y: 20, width: 10, height: 12 },
  ]).text, 'Hello')
})

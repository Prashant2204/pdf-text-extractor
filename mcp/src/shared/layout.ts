export type TextBox = { text: string; x: number; y: number; width: number; height: number }

export type OcrData = {
  text: string
  confidence?: number
  blocks?: { paragraphs: { lines: { words: {
    text: string
    bbox: { x0: number; y0: number; x1: number; y1: number }
  }[] }[] }[] }[] | null
}

export function formatOcrData(data: OcrData) {
  const paragraphs = data.blocks?.flatMap(block => block.paragraphs).map(paragraph =>
    formatBoxes(paragraph.lines.flatMap(line => line.words.map(word => ({
      text: word.text, x: word.bbox.x0, y: word.bbox.y0,
      width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0,
    })))).text,
  ).filter(Boolean) ?? []
  if (!paragraphs.length && data.text.trim()) paragraphs.push(...data.text.trim().split(/\n\s*\n/))
  return { text: paragraphs.join('\n\n'), paragraphs, confidence: data.confidence }
}

// A deliberately small row heuristic: top-to-bottom, then left-to-right.
// Large horizontal gaps become visible cell separators, not inferred tables.
export function formatBoxes(boxes: TextBox[]) {
  const rows: { y: number; height: number; boxes: TextBox[] }[] = []
  for (const box of boxes.filter(box => box.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1)
    if (row && Math.abs(row.y - box.y) <= Math.max(2, Math.min(row.height, box.height) * 0.4)) {
      row.boxes.push(box)
      row.height = Math.max(row.height, box.height)
    } else rows.push({ y: box.y, height: box.height, boxes: [box] })
  }
  const paragraphs: string[] = []
  let paragraph: string[] = []
  let previousRow: typeof rows[number] | undefined
  for (const row of rows) {
    if (previousRow && row.y - previousRow.y > Math.max(previousRow.height, row.height) * 1.6) {
      paragraphs.push(paragraph.join('\n'))
      paragraph = []
    }
    const sorted = row.boxes.sort((a, b) => a.x - b.x)
    let line = ''
    let previous: TextBox | undefined
    for (const box of sorted) {
      if (previous) {
        const gap = box.x - (previous.x + previous.width)
        if (gap > Math.max(12, row.height * 1.5)) line += ' | '
        else if (gap > row.height * 0.15 && !/\s$/.test(line) && !/^\s/.test(box.text)) line += ' '
      }
      line += box.text
      previous = box
    }
    paragraph.push(line.trim())
    previousRow = row
  }
  if (paragraph.length) paragraphs.push(paragraph.join('\n'))
  return { text: paragraphs.join('\n\n'), paragraphs }
}

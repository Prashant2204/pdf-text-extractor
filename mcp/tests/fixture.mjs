// Real PDF fixtures with no PDF-generation dependency.
export function makePdf(pageTexts = ['Hello from MCP', 'Second page']) {
  return makeDocument(pageTexts.map(text => ({
    content: text ? `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET` : '',
  })))
}

// JPEG-backed pages ensure OCR is tested on real pixels, not hidden text layers.
export function makeDocument(pages) {
  const objects = [null, null, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')]
  const add = value => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value)); return objects.length }
  const stream = (dictionary, data) => Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream'),
  ])
  const kids = pages.map(page => {
    let imageId
    if (page.image) imageId = add(stream(`/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, page.image))
    const content = add(stream('', Buffer.from([
      imageId ? 'q 612 0 0 792 0 0 cm /Scan Do Q' : '',
      page.content || '',
    ].join('\n'))))
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ${imageId ? `/XObject << /Scan ${imageId} 0 R >>` : ''} >> /Contents ${content} 0 R >>`)
  })
  objects[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`)
  const chunks = [Buffer.from('%PDF-1.4\n')]
  const offsets = []
  let length = chunks[0].length
  objects.forEach((object, i) => {
    offsets.push(length)
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')])
    chunks.push(chunk)
    length += chunk.length
  })
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(chunks)
}

export function makeLayoutPdf() {
  return makeDocument([{ content: [
    'BT /F1 12 Tf 300 680 Td (10 EUR) Tj ET',
    'BT /F1 12 Tf 300 720 Td (Amount) Tj ET',
    'BT /F1 12 Tf 50 720 Td (Item) Tj ET',
    'BT /F1 12 Tf 50 680 Td (Apples) Tj ET',
  ].join('\n') }])
}

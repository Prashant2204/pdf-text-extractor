#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 19)) {
  console.error(`PDF Text Extractor MCP requires Node.js 22.19 or newer; found ${process.version}. Switch to Node.js 24 and restart your MCP client.`)
  process.exit(1)
}

// PDF.js diagnostics can use console.log. Redirect before importing it so
// dependency diagnostics, including startup warnings, cannot corrupt STDIO.
console.log = (...args: unknown[]) => console.error(...args)
console.info = (...args: unknown[]) => console.error(...args)
const { extractPdfText } = await import('./extract.js')

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'pdf-text-extractor', version: '0.1.0' })
  server.registerTool('extract_pdf_text', {
    description: 'Extract local PDF text (up to 25 MiB), with English/German OCR fallback, page-level paragraphs, methods, and warnings. Retains full-document text.',
    inputSchema: z.object({ file_path: z.string().min(1).describe('Absolute local path to a .pdf file') }),
    outputSchema: z.object({
      success: z.boolean(),
      text: z.string(),
      error: z.string().optional(),
      page_count: z.number().int().nonnegative().optional(),
      pages_without_text: z.array(z.number().int().positive()).optional(),
      pages: z.array(z.object({
        page_number: z.number().int().positive(),
        method: z.enum(['embedded', 'ocr', 'none']),
        text: z.string(),
        paragraphs: z.array(z.string()),
        warnings: z.array(z.string()),
      })).optional(),
      warnings: z.array(z.string()).optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ file_path }) => {
    try {
      const result = await extractPdfText(file_path)
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false }
    } catch (error) {
      const result = { success: false, text: '', error: error instanceof Error ? error.message : 'PDF extraction failed.' }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true }
    }
  })
  return server
})

process.on('SIGINT', () => { void handle.close() })
process.on('SIGTERM', () => { void handle.close() })

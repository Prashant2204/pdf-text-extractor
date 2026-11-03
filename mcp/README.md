# PDF Text Extractor MCP

A local STDIO MCP server exposing exactly one tool, `extract_pdf_text`. It reads
embedded text with PDF.js, falls back to English/German OCR for scanned pages,
and returns page-level paragraphs in document order. No React app,
HTTP server, API key, or PDF upload is needed.

Requires Node.js **22.19 or newer** and npm (`node` and `npx` on PATH).

## Run the published package

Version **0.1.0** is available on
[npm](https://www.npmjs.com/package/prashant2204-pdf-text-extractor-mcp).
Launch it without cloning the repository or starting the React app:

```sh
npx -y prashant2204-pdf-text-extractor-mcp@0.1.0
```

The process waits for an MCP client on stdin. There is no interactive prompt.
The client normally launches this command itself.

## VS Code configuration

Put this in `.vscode/mcp.json`, then start the server from VS Code's MCP controls
and enable the tool in agent chat:

```json
{
  "servers": {
    "pdf-text-extractor": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "prashant2204-pdf-text-extractor-mcp@0.1.0"]
    }
  }
}
```

For a local development build, use `"command": "node"` and
`"args": ["/absolute/path/to/pdf-text-extractor/mcp/dist/index.js"]`
after building locally. Other clients may call the top-level key `mcpServers`
instead of `servers`; follow that client's configuration format.

Ask the client to extract a local PDF, or invoke `extract_pdf_text` with:

```json
{ "file_path": "/absolute/path/to/contract.pdf" }
```

In JSON on Windows use an absolute path such as `C:\\Users\\you\\contract.pdf`.
The path is on the machine running the MCP server.

## Result contract

Successful calls return `isError: false`, a JSON text content block, and the same
object in `structuredContent`:

```json
{
  "success": true,
  "text": "First page text\n\nSecond page text",
  "page_count": 2,
  "pages_without_text": [],
  "pages": [
    {
      "page_number": 1,
      "method": "embedded",
      "text": "First page text",
      "paragraphs": ["First page text"],
      "warnings": []
    },
    {
      "page_number": 2,
      "method": "ocr",
      "text": "Second page text",
      "paragraphs": ["Second page text"],
      "warnings": []
    }
  ],
  "warnings": []
}
```

File or extraction errors return `isError: true` with
`{ "success": false, "text": "", "error": "PDF file was not found." }`.
Missing or incorrectly typed arguments are rejected by the SDK with an MCP tool
error before extraction runs.

The original `text`, `page_count`, and `pages_without_text` fields remain available.
`text` joins nonempty pages with blank lines; each page's `text` joins its
`paragraphs` with blank lines and preserves line breaks within paragraphs.
`page_number` and `pages_without_text` use one-based page numbers.
`method` is `embedded`, `ocr`, or `none` when no text could be extracted and OCR
failed. An OCR attempt that completes but finds no text reports `ocr` with a warning.
Top-level `warnings` repeat page warnings with their page number.
`success: true` means the PDF was processed; consult warnings for partial results.

Only regular `.pdf` files with a PDF header are accepted, up to **25 MiB**.
Missing, unreadable, invalid, oversized, and password-protected files produce
errors. The server reads files without modifying them, executes no shell commands,
and makes no network requests for extraction. Diagnostics go to stderr; stdout
is reserved for MCP messages. PDF contents are never logged.

## Limitations

Pages with no embedded body text, including header/footer-only pages, use OCR.
Pages with fewer than 40 body-text characters and an image also use OCR.
Successful OCR replaces the page's embedded text to avoid duplicate headers.
If OCR fails or returns no text, any embedded text is retained and a warning is
returned. Pages still without text appear in `pages_without_text`.

English and German language models are bundled at build time. Extraction needs
no network connection, model download, or writable model cache. The OCR worker
is started only when needed, reused across the document, and terminated afterward.
OCR input is rendered at up to 2.5x PDF scale, capped at 8 million pixels per page.
OCR recognition, including engine startup but excluding PDF rendering, has a
60-second page limit. If the worker fails or times out, it is terminated;
remaining pages retain their embedded text with warnings.

Embedded text is grouped into rows and paragraphs by position. Large horizontal
gaps are represented as ` | ` for basic table readability. OCR uses Tesseract's
paragraph detection and word positions. These are readability heuristics, not
semantic table extraction or complex layout analysis. Multi-column, rotated,
handwritten, or poor-quality scanned pages may have incorrect order or text.
Pages with substantial embedded text over a scanned body may not trigger OCR.
Low OCR confidence generates a warning; higher confidence is not a correctness guarantee.
The size limit bounds input bytes, not PDF decompression or processing time.
The server can read any PDF accessible to its OS user; there is no directory sandbox.
Text is returned to the MCP client, whose own data handling settings apply.

## Development

From the repository root:

```sh
npm ci --prefix mcp
npm run build --prefix mcp
node mcp/dist/index.js
```

The CLI is a separate package so installing it does not install React.
It includes Tesseract.js and a native Node canvas dependency. Use a platform
supported by `@napi-rs/canvas` and allow npm to install its platform binary
(do not omit optional dependencies). Development model packages are copied into
`dist/tessdata/` by the build; consumers do not need development dependencies.
Its own lockfile provides a reproducible build. The root app commands are unchanged.

The browser service and this CLI use the same runtime-independent extraction core
in `src/shared/`: page processing, embedded-text reading, scan detection, OCR
fallback, paragraphs, table spacing and warnings. Browser and Node adapters retain
their own file access, PDF.js setup, rendering limits and OCR worker management.
The browser's existing result interface and this tool's JSON contract are preserved.
The build cleans generated output and includes compiled `dist/shared/` modules in
the tarball; runtime consumers need no shared source files from the repository.

## Test with MCP Inspector

Test the published package without cloning or building:

```sh
npx -y @modelcontextprotocol/inspector@2.13.0 --cli npx -y prashant2204-pdf-text-extractor-mcp@0.1.0 --method tools/list
npx -y @modelcontextprotocol/inspector@2.13.0 --cli npx -y prashant2204-pdf-text-extractor-mcp@0.1.0 --method tools/call --tool-name extract_pdf_text --tool-arg "file_path=/absolute/path/to/contract.pdf"
```

For the browser Inspector:

```sh
npx -y @modelcontextprotocol/inspector@2.13.0 npx -y prashant2204-pdf-text-extractor-mcp@0.1.0
```

Click Connect, open Tools, and invoke `extract_pdf_text` with a local PDF path.
Inspector is development tooling and is not a runtime dependency of this package.

To inspect a local development build, run from the repository root after building:

```sh
npx -y @modelcontextprotocol/inspector@2.13.0 --cli node mcp/dist/index.js --method tools/list
npx -y @modelcontextprotocol/inspector@2.13.0 --cli node mcp/dist/index.js --method tools/call --tool-name extract_pdf_text --tool-arg "file_path=/absolute/path/to/contract.pdf"
```

## Automated tests and packaging

```sh
npm test --prefix mcp
cd mcp
npm pack
```

Inspect the tarball with `tar -tzf prashant2204-pdf-text-extractor-mcp-0.1.0.tgz`.
It contains compiled JavaScript (including the OCR worker), both compressed
language models, third-party notices, this README and package metadata. Install it in
a separate directory to verify the executable without the source checkout:

```sh
mkdir /tmp/pdf-mcp-install
cd /tmp/pdf-mcp-install
npm install /absolute/path/to/mcp/prashant2204-pdf-text-extractor-mcp-0.1.0.tgz
./node_modules/.bin/pdf-text-extractor-mcp
```

To run the integration test against that installed executable from the repo root:

```sh
MCP_TEST_CLI=/tmp/pdf-mcp-install/node_modules/.bin/pdf-text-extractor-mcp npm test --prefix mcp
```

## Publish a new version

Version 0.1.0 is already published. Published versions cannot be overwritten;
increment the version for the next release and update pinned version examples
in both READMEs.
Project code is licensed under MIT; the package includes `LICENSE` with
copyright © 2026 Prashant Bhatia. Bundled OCR models retain their Apache-2.0
license and attribution in `THIRD_PARTY_NOTICES.md` and `licenses/Apache-2.0.txt`.

From `mcp/`:

```sh
npm login --auth-type=web
npm version patch --no-git-tag-version
npm test
npm pack
npm publish --dry-run --access public
npm publish --access public --auth-type=web
```

Inspect and test the packed artifact before publishing, as described above.
Publishing requires access to the maintainer's npm account with 2FA enabled;
complete any browser approval prompted by npm. Commit the version, lockfile and
documentation changes for the release. The build and tests do not publish
automatically. Publish from `mcp/`, since the root React package remains private.

The integration test runs real English/German OCR on generated image-only PDF
pages, mixed header/scan pages, blank pages, and embedded-text pages through STDIO.
Other tests cover ordering, table gaps, OCR timeouts, and partial results when
image inspection or OCR assets fail. The same integration test can target the
installed executable as above.
See `THIRD_PARTY_NOTICES.md` for bundled model attribution.

## Official references

- [SDK first server](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-server.md)
- [SDK STDIO transport](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)

Implementation verified against stable `@modelcontextprotocol/server` 2.4.0,
using `McpServer.registerTool()` and `serveStdio()`. Browser and MCP packages
both use PDF.js 6.5.438.

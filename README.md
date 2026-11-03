# PDF Text Extractor

Extract PDF text through a browser application or a local MCP server for AI agents.
Both share an extraction core with English/German OCR fallback for scanned pages.
The MCP server returns full-document text, page-level paragraphs, extraction
methods, and warnings, with basic table readability.

Upload a PDF to the React application to view its text in the browser, or connect
an MCP client such as VS Code to the published
[`pdf-text-extractor-mcp`](https://www.npmjs.com/package/pdf-text-extractor-mcp)
package. PDF extraction runs locally in either environment.

## Run locally

Requires Node.js 22.19+ and npm.

```sh
npm ci
npm run dev
```

Other useful commands:

```sh
npm test
npm run build
npm run lint
```

## Using PDF Text Extractor as an MCP Server

The separate [`mcp/` package](mcp/README.md) exposes one local STDIO tool,
`extract_pdf_text`, with embedded PDF text and English/German OCR fallback.
It requires **Node.js 22.19+** and npm. The React app does not need to be running.
Both OCR language models are packaged locally; extraction does not download models.

The package is published on [npm](https://www.npmjs.com/package/pdf-text-extractor-mcp).
It is also listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Prashant2204%2Fpdf-text-extractor-mcp/versions/0.1.1)
as `io.github.Prashant2204/pdf-text-extractor-mcp`. The registry link shows the
published metadata for version **0.1.1**.

Launch version **0.1.1** without cloning this repository:

```sh
npx -y pdf-text-extractor-mcp@0.1.1
```

The process waits for an MCP client on stdin. To test it interactively with the
official MCP Inspector:

```sh
npx -y @modelcontextprotocol/inspector@2.13.0 npx -y pdf-text-extractor-mcp@0.1.1
```

Click **Connect**, open **Tools**, select `extract_pdf_text`, and enter the absolute
path to a PDF on your computer.

For VS Code, add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "pdf-text-extractor": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "pdf-text-extractor-mcp@0.1.1"]
    }
  }
}
```

The client launches the process and discovers `extract_pdf_text`. Provide
`{ "file_path": "/absolute/path/to/example.pdf" }` using a path on the server's
machine. Results include full-document text and page-level paragraphs, extraction
methods and warnings. OCR supports English and German; complex layouts and OCR
accuracy are not guaranteed.

### Example: use with an AI agent

After connecting the server and enabling `extract_pdf_text`, ask your agent:

> Use `extract_pdf_text` to read `/absolute/path/to/contract.pdf`, then summarize
> its important clauses. Include page references and mention extraction warnings.

The tool supplies the extracted text; the agent creates the summary. The MCP
server itself does not use an LLM. Text returned to the agent follows your MCP
client and model provider's data handling settings.

See the [MCP package README](mcp/README.md) for the complete result contract,
Inspector CLI instructions, package verification and future releases.

To develop the MCP server from this repository:

```sh
npm ci --prefix mcp
npm run build --prefix mcp
node mcp/dist/index.js
```

For a local development build in VS Code, use `"command": "node"` and
`"args": ["/absolute/path/to/pdf-text-extractor/mcp/dist/index.js"]`.

## Architecture

The browser app and Node MCP server share the extraction core in
`mcp/src/shared/`. It handles page iteration, embedded-text reading, scan detection,
OCR fallback, paragraphs, basic table spacing, warnings, and document text assembly.
The shared code imports no browser, Node, PDF.js, or Tesseract runtime modules.

The browser service reads uploaded files and supplies browser canvas/OCR workers.
The MCP wrapper validates local paths and supplies Node canvas/workers and bundled
models. Rendering limits and model delivery remain specific to each environment.
Both run locally without uploading PDFs to an application server.

The React service keeps its existing `{ text, pagesWithoutBodyText }` interface;
the MCP tool keeps its existing page-level JSON contract. Shared modules compile
into the MCP tarball, so installing the CLI still needs no repository checkout.

## Testing

`npm test` checks the browser adapter's multi-page ordering, invalid input, empty
text, parser errors, OCR fallback, worker reuse and OCR startup failure. Most tests
mock PDF.js/Tesseract; a real PDF.js fixture also checks reading order and table
spacing. The same PDF fixture is checked through the MCP tool to verify both
wrappers use the same formatting rules.

`npm test --prefix mcp` checks the shared formatter, real English/German OCR
through STDIO, file errors, and partial results when OCR models are unavailable.

## Limitations

Files are limited to 25 MiB. OCR can be slow or inaccurate on poor-quality scans. Pages that contain some embedded body text alongside an image may not trigger OCR. Complex tables and multi-column layouts may not preserve their visual structure. PNG and JPEG files are not accepted directly.

## License

Project code is licensed under the [MIT License](LICENSE), copyright © 2026
Prashant Bhatia. Third-party dependencies retain their own licenses. Bundled
OCR model attribution and the Apache-2.0 license are preserved in the MCP
package's [third-party notices](mcp/THIRD_PARTY_NOTICES.md).

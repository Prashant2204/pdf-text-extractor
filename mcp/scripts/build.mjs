import { chmod, copyFile, mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// Remove stale generated files when shared modules move or are deleted.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true })
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p',
  fileURLToPath(new URL('../tsconfig.json', import.meta.url))], { stdio: 'inherit' })
const directory = new URL('../dist/tessdata/', import.meta.url)
await mkdir(directory, { recursive: true })
const { OCR_LANGUAGES } = await import('../dist/shared/extraction.js')
for (const code of OCR_LANGUAGES) {
  await copyFile(
    require.resolve(`@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`),
    new URL(`${code}.traineddata.gz`, directory),
  )
}
await chmod(new URL('../dist/index.js', import.meta.url), 0o755)

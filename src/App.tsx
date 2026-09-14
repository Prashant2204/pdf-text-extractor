import { useState } from 'react'
import { PdfUploader } from './components/PdfUploader'
import { TextOutput } from './components/TextOutput'
import { extractPdfText, type ExtractionResult } from './services/pdfTextExtractor'
import './App.css'

function App() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ExtractionResult | null>(null)

  async function handleSelect(file: File) {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const extracted = await extractPdfText(file)
      setResult(extracted)
    } catch (error) {
      setError(error instanceof Error ? error.message : "We couldn't process this PDF.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <div className="intro">
        <h1>PDF text extraction</h1>
        <p>Select a PDF to extract and display its text.</p>
      </div>
      <PdfUploader busy={busy} onSelect={handleSelect} />
      <div role="status" className="status">{busy ? 'Extracting text…' : ''}</div>
      {error && <p role="alert" className="error">{error}</p>}
      {result && <TextOutput {...result} />}
    </main>
  )
}

export default App

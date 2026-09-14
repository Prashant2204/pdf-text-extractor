type Props = {
  busy: boolean
  onSelect: (file: File) => void
}

export function PdfUploader({ busy, onSelect }: Props) {
  return (
    <section className="upload-panel" aria-labelledby="pdf-label">
      <label id="pdf-label" className="file-label" htmlFor="pdf-file">Choose PDF</label>
      <input
        id="pdf-file"
        type="file"
        accept=".pdf,application/pdf"
        aria-describedby="file-hint"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = '' // Allow selecting the same file again.
          if (file) onSelect(file)
        }}
      />
      <span id="file-hint" className="file-hint">PDF files · Up to 25 MB</span>
    </section>
  )
}

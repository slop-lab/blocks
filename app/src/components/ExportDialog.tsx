import { DownloadIcon, UploadIcon } from "@radix-ui/react-icons"
import { useMemo, useState } from "react"
import { encodeDocument, parseDocumentText } from "../core/codec"
import { exportHtml, exportMarkdown } from "../core/headless"
import type { BlockDocument } from "../core/types"
import { DialogFrame } from "./DialogFrame"

type Format = "json" | "markdown" | "html"

export const ExportDialog = ({
  document,
  onClose,
  onImport,
}: {
  readonly document: BlockDocument
  readonly onClose: () => void
  readonly onImport: (document: BlockDocument) => void
}) => {
  const [format, setFormat] = useState<Format>("json")
  const [importText, setImportText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const exported = useMemo(() => {
    if (format === "json") return { output: encodeDocument(document), losses: [] }
    const limits = { maxBlocks: 10_000, maxText: 500_000 }
    return format === "html" ? exportHtml(document, limits) : exportMarkdown(document, limits)
  }, [document, format])
  const importDocument = () => {
    try {
      onImport(parseDocumentText(importText))
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown import error")
    }
  }
  return (
    <DialogFrame
      titleId="export-title"
      eyebrow="PORTABLE DOCUMENT"
      title="Import / Export"
      onClose={onClose}
    >
      <div className="segmented">
        {(["json", "markdown", "html"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={format === item}
            onClick={() => setFormat(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <label className="field">
        <span>
          <DownloadIcon />
          Export output
        </span>
        <textarea readOnly value={exported.output} rows={9} />
      </label>
      {exported.losses.length > 0 && (
        <div className="loss-report">
          <strong>Loss report: {exported.losses.length}</strong>
          {exported.losses.map((loss) => (
            <p key={loss.blockId}>
              {loss.blockId}: {loss.reason}
            </p>
          ))}
        </div>
      )}
      <label className="field">
        <span>
          <UploadIcon />
          Import JSON · 2 MB limit
        </span>
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          rows={4}
          placeholder="block-editor/v0.3 JSON to validate"
        />
      </label>
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button className="button button--ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={importDocument}
          disabled={importText.length === 0}
        >
          Validate and import
        </button>
      </footer>
    </DialogFrame>
  )
}

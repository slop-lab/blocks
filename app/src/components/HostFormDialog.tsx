import { useState } from "react"
import type { ReleaseForm } from "../host/store"
import { DialogFrame } from "./DialogFrame"

type HostFormDialogProps = {
  readonly form: ReleaseForm
  readonly onClose: () => void
  readonly onSave: (draft: Omit<ReleaseForm, "revision">, expectedRevision: number) => boolean
}

export const HostFormDialog = ({ form, onClose, onSave }: HostFormDialogProps) => {
  const [audience, setAudience] = useState(form.audience)
  const [window, setWindow] = useState(form.window)
  const [notes, setNotes] = useState(form.notes)
  const [error, setError] = useState<string | null>(null)

  return (
    <DialogFrame
      titleId="host-form-title"
      eyebrow="HOST-BUFFERED DRAFT"
      title="Edit release briefing"
      onClose={onClose}
    >
      <p className="dialog__description">
        This draft is host state outside the document. Task cards and the document version remain
        unchanged until you save.
      </p>
      <label className="field">
        <span>Audience</span>
        <input value={audience} onChange={(event) => setAudience(event.target.value)} />
      </label>
      <label className="field">
        <span>Release window</span>
        <input value={window} onChange={(event) => setWindow(event.target.value)} />
      </label>
      <label className="field">
        <span>Host notes</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
      </label>
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button className="button button--ghost" type="button" onClick={onClose}>
          Discard draft
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={audience.trim().length === 0 || window.trim().length === 0}
          onClick={() => {
            const saved = onSave({ audience, window, notes }, form.revision)
            if (saved) onClose()
            else
              setError(
                "Host data was updated elsewhere. Close this dialog and try again with the latest values.",
              )
          }}
        >
          Save to host
        </button>
      </footer>
    </DialogFrame>
  )
}

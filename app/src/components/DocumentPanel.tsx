import type { SaveMode } from "../host/useDocumentSessions"

type Props = {
  readonly saveMode: SaveMode
  readonly onSaveMode: (mode: SaveMode) => void
  readonly dirty: boolean
  readonly hostDirty: boolean
  readonly onSave: () => void
  readonly onForm: () => void
  readonly onReview: () => void
  readonly onRefresh: () => void
}

export const DocumentPanel = (props: Props) => (
  <aside className="inspector document-panel" aria-label="Document settings">
    <div className="inspector__header">
      <h2>Document settings</h2>
    </div>
    <div className="inspector__body panel-stack">
      <section className="inspector-card">
        <label className="field">
          <span>Save mode</span>
          <select
            aria-label="Save mode"
            value={props.saveMode}
            onChange={(event) => {
              const mode = event.target.value
              if (
                mode === "manual" ||
                mode === "debounce" ||
                mode === "throttle" ||
                mode === "blur"
              )
                props.onSaveMode(mode)
            }}
          >
            <option value="manual">Save manually</option>
            <option value="debounce">Save after typing stops</option>
            <option value="throttle">Save at regular intervals</option>
            <option value="blur">Save when leaving the editor</option>
          </select>
        </label>
        <p>
          {props.saveMode === "manual"
            ? "Use the save button to store the current content."
            : props.saveMode === "debounce"
              ? "Saves 600ms after typing stops, or every 3 seconds during continuous typing."
              : props.saveMode === "throttle"
                ? "Saves the latest content every second while you type."
                : "Saves when focus moves to another area."}
        </p>
        <p role="status">Document: {props.dirty ? "Unsaved changes" : "Saved"}</p>
        <button className="button button--primary" type="button" onClick={props.onSave}>
          Save now
        </button>
        <small className="muted">This document is stored in this browser.</small>
      </section>
      <section className="inspector-card button-stack">
        <h3>Document actions</h3>
        <button className="button button--secondary" type="button" onClick={props.onReview}>
          Compare revision
        </button>
        <button className="button button--secondary" type="button" onClick={props.onForm}>
          Edit briefing details
        </button>
        <p>Task status: {props.hostDirty ? "Changed" : "Saved"}</p>
        <button className="button button--ghost" type="button" onClick={props.onRefresh}>
          Fetch latest guide
        </button>
      </section>
    </div>
  </aside>
)

import type { BlockDocument } from "@slop-lab/blocks"
import { useCallback, useRef, useState } from "react"
import { CustomNotesEditor } from "./CustomNotesEditor"

const storageKey = "ownership:notebook"
const initial: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "note-1",
      type: "notes.text",
      attrs: {},
      content: [{ kind: "text", text: "Record today's observations here.", marks: [] }],
    },
    {
      id: "callout-1",
      type: "notes.callout",
      attrs: {},
      content: [
        { kind: "text", text: "This document uses notes.text as its default block.", marks: [] },
      ],
    },
  ],
}

const stored = (): BlockDocument => {
  const raw = localStorage.getItem(storageKey)
  return raw === null ? initial : JSON.parse(raw)
}

export const NotebookScenario = () => {
  const [document, setDocument] = useState(stored)
  const [editorKey, setEditorKey] = useState(0)
  const [dirty, setDirty] = useState(false)
  const draft = useRef(document)
  const changed = useCallback((next: BlockDocument) => {
    draft.current = next
    setDirty(true)
  }, [])
  const save = () => {
    localStorage.setItem(storageKey, JSON.stringify(draft.current))
    setDocument(draft.current)
    setDirty(false)
  }
  const reload = () => {
    const next = stored()
    draft.current = next
    setDocument(next)
    setEditorKey((value) => value + 1)
    setDirty(false)
  }
  return (
    <section className="ownership-scenario" aria-labelledby="notebook-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">BLOCK CANONICAL</span>
          <h2 id="notebook-title">Personal research notes</h2>
        </div>
        <div className="button-row">
          <span
            className={
              dirty ? "status-badge status-badge--warning" : "status-badge status-badge--success"
            }
          >
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <button className="button button--secondary" type="button" onClick={reload}>
            Reload
          </button>
          <button className="button button--primary" type="button" onClick={save} disabled={!dirty}>
            Save
          </button>
        </div>
      </header>
      <p className="ownership-explainer">
        The block document is the source of truth without a domain object. It registers no default
        paragraph and uses only <code>notes.text</code> and callouts.
      </p>
      <CustomNotesEditor key={editorKey} document={document} onChange={changed} onSave={save} />
    </section>
  )
}

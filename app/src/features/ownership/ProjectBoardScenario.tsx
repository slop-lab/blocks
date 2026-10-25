import { type BlockDocument, encodeDocument } from "@slop-lab/blocks"
import { BlockViewer } from "@slop-lab/blocks/viewer"
import { useCallback, useRef, useState } from "react"
import { parseDocumentText } from "../../core/codec"
import { CanonicalBlockEditor, type CanonicalBlockEditorHandle } from "./CustomNotesEditor"
import { presentationProfile, presentationRenderers } from "./presentation-profile"

const tasks = [
  { id: "TASK-21", title: "Onboarding interviews", status: "running" },
  { id: "TASK-22", title: "Publish findings", status: "done" },
] as const
const initial: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "card-1",
      type: "ownership.task-card",
      attrs: { taskId: "TASK-21" },
      content: [{ kind: "text", text: "First screen", marks: [] }],
    },
    {
      id: "card-2",
      type: "ownership.task-card",
      attrs: { taskId: "TASK-21" },
      content: [{ kind: "text", text: "Summary card for the same task", marks: [] }],
    },
  ],
}
const storageKey = "ownership.project-board.presentation"
const loadSaved = (): BlockDocument => {
  const stored = localStorage.getItem(storageKey)
  if (stored === null) return initial
  try {
    return parseDocumentText(stored)
  } catch (error) {
    if (error instanceof Error) return initial
    throw error
  }
}

export const ProjectBoardScenario = () => {
  const [saved, setSaved] = useState<BlockDocument>(loadSaved)
  const [draft, setDraft] = useState(saved)
  const editor = useRef<CanonicalBlockEditorHandle>(null)
  const dirty = encodeDocument(draft) !== encodeDocument(saved)
  const viewData = new Map(
    draft.blocks.map((block) => [
      block.id,
      tasks.find((task) => task.id === block.attrs["taskId"]),
    ]),
  )
  const changed = useCallback((next: BlockDocument) => setDraft(next), [])
  const save = () => {
    localStorage.setItem(storageKey, encodeDocument(draft))
    setSaved(draft)
  }
  const reload = () => {
    if (dirty && !window.confirm("Discard unsaved presentation changes?")) return
    setDraft(saved)
    editor.current?.reset(saved)
  }
  const duplicate = () => {
    const source = draft.blocks.find((block) => block.type === "ownership.task-card")
    if (source !== undefined) editor.current?.duplicateBlock(source.id)
  }
  const remove = () => {
    const source = draft.blocks.at(-1)
    if (source !== undefined) editor.current?.deleteBlock(source.id)
  }
  return (
    <section className="ownership-scenario" aria-labelledby="board-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">DOMAIN + PRESENTATION</span>
          <h2 id="board-title">Project board</h2>
        </div>
        <div className="button-row">
          <span
            className={
              dirty ? "status-badge status-badge--warning" : "status-badge status-badge--success"
            }
          >
            {dirty ? "Unsaved changes" : "Presentation saved"}
          </span>
          <button className="button button--secondary" type="button" onClick={reload}>
            Reopen saved version
          </button>
          <button className="button button--primary" type="button" onClick={save} disabled={!dirty}>
            Save presentation
          </button>
        </div>
      </header>
      <p className="ownership-explainer">
        External tasks are ViewData. Only the card layout and captions below belong to the
        BlockDocument source.
      </p>
      <BlockViewer content={draft} renderers={presentationRenderers} viewData={viewData} />
      <CanonicalBlockEditor
        ref={editor}
        document={draft}
        onChange={changed}
        profile={presentationProfile}
        modelId="project-board-presentation"
        label="Project board presentation editor"
      />
      <div className="button-row">
        <button className="button button--secondary" type="button" onClick={duplicate}>
          Duplicate card
        </button>
        <button className="button button--danger" type="button" onClick={remove}>
          Delete last card
        </button>
      </div>
      <footer role="status">
        {tasks.length} domain tasks · {draft.blocks.length} presentation blocks
      </footer>
    </section>
  )
}

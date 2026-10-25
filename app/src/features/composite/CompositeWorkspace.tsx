import type { EditorView as CodeView } from "@codemirror/view"
import { CheckIcon, CodeIcon, FileTextIcon } from "@radix-ui/react-icons"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CompositeContext } from "./CompositeToolbar"
import { CompositeToolbar } from "./CompositeToolbar"
import { NestedCodeEditor } from "./NestedCodeEditor"
import { ProseMirrorSurface } from "./ProseMirrorSurface"
import { createCompositeDraftWriter, initializeCompositeWorkspace } from "./persistence"
import type { CompositeSnapshot, CompositeSnapshotV1 } from "./profile"
import { compositeSchema, createCompositeSnapshot, migrateCompositeSnapshot } from "./profile"
import "./composite.css"

export type CompositeWorkspaceProps = {
  readonly initialSnapshot?: CompositeSnapshot | CompositeSnapshotV1
  readonly onSave?: (snapshot: CompositeSnapshot) => void
  readonly storage?: Storage
}

export const CompositeWorkspace = ({
  initialSnapshot,
  onSave,
  storage,
}: CompositeWorkspaceProps) => {
  const workspaceStorage = storage ?? window.localStorage
  const initial = useMemo(() => {
    const fallback = migrateCompositeSnapshot(initialSnapshot ?? createCompositeSnapshot()).snapshot
    if (initialSnapshot !== undefined) return { saved: fallback, draft: fallback }
    return initializeCompositeWorkspace(workspaceStorage, fallback)
  }, [initialSnapshot, workspaceStorage])
  const [proseDocument, setProseDocument] = useState<ProseMirrorNode>(() =>
    compositeSchema.nodeFromJSON(initial.draft.document),
  )
  const [codeDraft, setCodeDraft] = useState(initial.draft.code)
  const [workspaceDirty, setWorkspaceDirty] = useState(
    () => JSON.stringify(initial.saved) !== JSON.stringify(initial.draft),
  )
  const [activeContext, setActiveContext] = useState<CompositeContext>("prose")
  const activeContextRef = useRef<CompositeContext>(activeContext)
  activeContextRef.current = activeContext
  const claimContext = (context: CompositeContext) => {
    activeContextRef.current = context
    setActiveContext(context)
  }
  const [proseView, setProseView] = useState<EditorView | null>(null)
  const [codeView, setCodeView] = useState<CodeView | null>(null)
  const [status, setStatus] = useState("The itinerary table is ready to edit.")

  const proseDocumentRef = useRef(proseDocument)
  const codeDraftRef = useRef(codeDraft)
  const savedDocumentRef = useRef(compositeSchema.nodeFromJSON(initial.saved.document))
  const savedCodeRef = useRef(initial.saved.code)
  proseDocumentRef.current = proseDocument
  codeDraftRef.current = codeDraft
  const draftWriter = useMemo(
    () => createCompositeDraftWriter(workspaceStorage),
    [workspaceStorage],
  )
  const currentSnapshot = (): CompositeSnapshot => ({
    schemaVersion: 2,
    document: proseDocumentRef.current.toJSON(),
    code: codeDraftRef.current,
  })

  useEffect(() => {
    if (initialSnapshot !== undefined) return draftWriter.cancel
    const flushDraft = () => draftWriter.flush()
    window.addEventListener("pagehide", flushDraft)
    return () => {
      window.removeEventListener("pagehide", flushDraft)
      draftWriter.cancel()
    }
  }, [draftWriter, initialSnapshot])

  const saveWorkspace = () => {
    const snapshot = currentSnapshot()
    draftWriter.commit(snapshot)
    savedDocumentRef.current = proseDocumentRef.current
    savedCodeRef.current = codeDraftRef.current
    setWorkspaceDirty(false)
    onSave?.(snapshot)
    setStatus("Saved the travel workshop document and code together.")
  }

  return (
    <section className="composite-workspace" aria-labelledby="composite-title">
      <header className="composite-header">
        <div>
          <span className="eyebrow">Travel workshop</span>
          <h1 id="composite-title">Travel workshop plan</h1>
          <p>
            Organize the itinerary and notes, then refine the travel preparation data in the
            adjacent code editor.
          </p>
        </div>
        <span
          className={
            workspaceDirty
              ? "status-badge status-badge--warning"
              : "status-badge status-badge--success"
          }
        >
          {workspaceDirty ? "Unsaved changes" : "All changes saved"}
        </span>
      </header>

      <CompositeToolbar
        activeContext={activeContext}
        proseView={proseView}
        codeView={codeView}
        onStatus={setStatus}
      />

      <div className="composite-layout">
        <article
          className={
            activeContext === "prose" ? "composite-slot composite-slot--active" : "composite-slot"
          }
        >
          <header className="composite-slot__header">
            <div>
              <span className="eyebrow">Table document</span>
              <h2>
                <FileTextIcon /> Itinerary and decisions
              </h2>
            </div>
            <span className="status-badge">Table and caption</span>
          </header>
          <ProseMirrorSurface
            document={proseDocument}
            active={() => activeContextRef.current === "prose"}
            onChange={(document) => {
              proseDocumentRef.current = document
              setProseDocument(document)
              setWorkspaceDirty(
                !document.eq(savedDocumentRef.current) ||
                  codeDraftRef.current !== savedCodeRef.current,
              )
              if (initialSnapshot === undefined) draftWriter.schedule(currentSnapshot)
            }}
            onReady={setProseView}
            onActivate={() => {
              claimContext("prose")
              setStatus("Editing the itinerary table. Press Tab to move to the next cell.")
            }}
          />
        </article>

        <aside
          className={
            activeContext === "code" ? "composite-slot composite-slot--active" : "composite-slot"
          }
          aria-labelledby="nested-code-title"
        >
          <header className="composite-slot__header">
            <div>
              <span className="eyebrow">Travel code</span>
              <h2 id="nested-code-title">
                <CodeIcon /> Preparation data
              </h2>
            </div>
            <span className="status-badge">Code</span>
          </header>
          <p className="composite-slot__description">
            Press Tab to indent. Undo and Select All apply only within this code editor.
          </p>
          <NestedCodeEditor
            initialCode={initial.draft.code}
            onChange={(code) => {
              codeDraftRef.current = code
              setCodeDraft(code)
              setWorkspaceDirty(
                !proseDocumentRef.current.eq(savedDocumentRef.current) ||
                  code !== savedCodeRef.current,
              )
              if (initialSnapshot === undefined) draftWriter.schedule(currentSnapshot)
            }}
            onReady={setCodeView}
            onActivate={() => {
              claimContext("code")
              setStatus("Editing the travel preparation data.")
            }}
          />
          <footer className="composite-code-actions">
            <span className="muted">
              {workspaceDirty ? "The itinerary or code has changed." : "This travel plan is saved."}
            </span>
            <button
              className="button button--primary"
              type="button"
              disabled={!workspaceDirty}
              onClick={saveWorkspace}
            >
              <CheckIcon /> Save document and code
            </button>
          </footer>
        </aside>
      </div>

      <p className="composite-status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}

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
  const [status, setStatus] = useState("일정 표를 편집할 수 있습니다.")

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
    setStatus("여행 워크숍 문서와 코드를 함께 저장했습니다.")
  }

  return (
    <section className="composite-workspace" aria-labelledby="composite-title">
      <header className="composite-header">
        <div>
          <span className="eyebrow">여행 워크숍</span>
          <h1 id="composite-title">여행 워크숍 계획</h1>
          <p>일정 표와 설명을 정리하고, 옆의 코드에서 여행 준비 데이터를 함께 다듬어 보세요.</p>
        </div>
        <span
          className={
            workspaceDirty
              ? "status-badge status-badge--warning"
              : "status-badge status-badge--success"
          }
        >
          {workspaceDirty ? "저장되지 않은 변경" : "모두 저장됨"}
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
              <span className="eyebrow">표 문서</span>
              <h2>
                <FileTextIcon /> 일정과 결정
              </h2>
            </div>
            <span className="status-badge">표와 캡션</span>
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
              setStatus("일정 표를 편집하고 있습니다. Tab으로 다음 칸으로 이동할 수 있습니다.")
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
              <span className="eyebrow">여행 코드</span>
              <h2 id="nested-code-title">
                <CodeIcon /> 준비 데이터
              </h2>
            </div>
            <span className="status-badge">코드</span>
          </header>
          <p className="composite-slot__description">
            Tab으로 들여쓰고, 실행 취소와 전체 선택은 이 코드 칸 안에서만 동작합니다.
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
              setStatus("여행 준비 데이터를 편집하고 있습니다.")
            }}
          />
          <footer className="composite-code-actions">
            <span className="muted">
              {workspaceDirty ? "일정 또는 코드가 변경되었습니다." : "저장된 여행 계획입니다."}
            </span>
            <button
              className="button button--primary"
              type="button"
              disabled={!workspaceDirty}
              onClick={saveWorkspace}
            >
              <CheckIcon /> 문서와 코드 저장
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

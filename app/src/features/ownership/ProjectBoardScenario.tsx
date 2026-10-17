import { type BlockDocument, encodeDocument } from "@slop-lab/blocks"
import { BlockViewer } from "@slop-lab/blocks/viewer"
import { useCallback, useRef, useState } from "react"
import { parseDocumentText } from "../../core/codec"
import { CanonicalBlockEditor, type CanonicalBlockEditorHandle } from "./CustomNotesEditor"
import { presentationProfile, presentationRenderers } from "./presentation-profile"

const tasks = [
  { id: "TASK-21", title: "온보딩 인터뷰", status: "running" },
  { id: "TASK-22", title: "결과 문서 배포", status: "done" },
] as const
const initial: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "card-1",
      type: "ownership.task-card",
      attrs: { taskId: "TASK-21" },
      content: [{ kind: "text", text: "첫 번째 화면", marks: [] }],
    },
    {
      id: "card-2",
      type: "ownership.task-card",
      attrs: { taskId: "TASK-21" },
      content: [{ kind: "text", text: "같은 작업의 요약 카드", marks: [] }],
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
    if (dirty && !window.confirm("저장하지 않은 표현 변경을 버리시겠습니까?")) return
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
          <h2 id="board-title">프로젝트 보드</h2>
        </div>
        <div className="button-row">
          <span
            className={
              dirty ? "status-badge status-badge--warning" : "status-badge status-badge--success"
            }
          >
            {dirty ? "저장 전 변경" : "표현 저장됨"}
          </span>
          <button className="button button--secondary" type="button" onClick={reload}>
            저장본 다시 열기
          </button>
          <button className="button button--primary" type="button" onClick={save} disabled={!dirty}>
            표현 저장
          </button>
        </div>
      </header>
      <p className="ownership-explainer">
        외부 작업은 ViewData이고, 아래 카드 배치와 캡션만 BlockDocument 원본입니다.
      </p>
      <BlockViewer content={draft} renderers={presentationRenderers} viewData={viewData} />
      <CanonicalBlockEditor
        ref={editor}
        document={draft}
        onChange={changed}
        profile={presentationProfile}
        modelId="project-board-presentation"
        label="프로젝트 보드 표현 편집기"
      />
      <div className="button-row">
        <button className="button button--secondary" type="button" onClick={duplicate}>
          카드 복제
        </button>
        <button className="button button--danger" type="button" onClick={remove}>
          마지막 카드 삭제
        </button>
      </div>
      <footer role="status">
        도메인 작업 {tasks.length}개 · 표현 블록 {draft.blocks.length}개
      </footer>
    </section>
  )
}

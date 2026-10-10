import type { BlockDocument } from "@block-editor/model"
import { BlockViewer } from "@block-editor/model/viewer"
import { useCallback, useState } from "react"
import { CanonicalBlockEditor } from "./CustomNotesEditor"
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

export const ProjectBoardScenario = () => {
  const [saved, setSaved] = useState<BlockDocument>(() => {
    const stored = localStorage.getItem(storageKey)
    return stored === null ? initial : JSON.parse(stored)
  })
  const [draft, setDraft] = useState(saved)
  const [editorKey, setEditorKey] = useState(0)
  const viewData = new Map(
    draft.blocks.map((block) => [
      block.id,
      tasks.find((task) => task.id === block.attrs["taskId"]),
    ]),
  )
  const changed = useCallback((next: BlockDocument) => setDraft(next), [])
  const save = () => {
    localStorage.setItem(storageKey, JSON.stringify(draft))
    setSaved(draft)
  }
  const reload = () => {
    setDraft(saved)
    setEditorKey((value) => value + 1)
  }
  const duplicate = () => {
    const source = draft.blocks.find((block) => block.type === "ownership.task-card")
    if (source !== undefined)
      setDraft({ ...draft, blocks: [...draft.blocks, { ...source, id: crypto.randomUUID() }] })
  }
  const remove = () => setDraft({ ...draft, blocks: draft.blocks.slice(0, -1) })
  return (
    <section className="ownership-scenario" aria-labelledby="board-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">DOMAIN + PRESENTATION</span>
          <h2 id="board-title">프로젝트 보드</h2>
        </div>
        <div className="button-row">
          <button className="button button--secondary" type="button" onClick={reload}>
            저장본 다시 열기
          </button>
          <button className="button button--primary" type="button" onClick={save}>
            표현 저장
          </button>
        </div>
      </header>
      <p className="ownership-explainer">
        외부 작업은 ViewData이고, 아래 카드 배치와 캡션만 BlockDocument 원본입니다.
      </p>
      <BlockViewer content={draft} renderers={presentationRenderers} viewData={viewData} />
      <CanonicalBlockEditor
        key={editorKey}
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

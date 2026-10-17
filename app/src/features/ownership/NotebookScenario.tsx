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
      content: [{ kind: "text", text: "오늘의 관찰을 여기에 기록합니다.", marks: [] }],
    },
    {
      id: "callout-1",
      type: "notes.callout",
      attrs: {},
      content: [
        { kind: "text", text: "이 문서는 notes.text를 기본 블록으로 사용합니다.", marks: [] },
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
          <h2 id="notebook-title">개인 연구 노트</h2>
        </div>
        <div className="button-row">
          <span
            className={
              dirty ? "status-badge status-badge--warning" : "status-badge status-badge--success"
            }
          >
            {dirty ? "저장 전 변경" : "저장됨"}
          </span>
          <button className="button button--secondary" type="button" onClick={reload}>
            다시 불러오기
          </button>
          <button className="button button--primary" type="button" onClick={save} disabled={!dirty}>
            저장
          </button>
        </div>
      </header>
      <p className="ownership-explainer">
        도메인 객체 없이 블록 문서가 원본입니다. 기본 paragraph는 등록하지 않고{" "}
        <code>notes.text</code>와 callout만 사용합니다.
      </p>
      <CustomNotesEditor key={editorKey} document={document} onChange={changed} onSave={save} />
    </section>
  )
}

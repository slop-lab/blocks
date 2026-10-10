import { useEffect, useMemo, useRef, useState } from "react"
import { parseDocumentText } from "../core/codec"
import type { SuggestionProvider } from "../core/proposals"
import { acceptChanges, compareDocuments, SuggestionStream } from "../core/proposals"
import type { BlockDocument } from "../core/types"
import { BlockViewer } from "../Viewer"
import { DialogFrame } from "./DialogFrame"

const localSuggestions: SuggestionProvider = async function* ({ document, instruction, signal }) {
  const id = crypto.randomUUID()
  let text = ""
  for (const part of instruction.split(/(\s+)/)) {
    if (signal.aborted) return
    text += part
    await new Promise((resolve) => setTimeout(resolve, 35))
    yield {
      ...document,
      blocks: [
        ...document.blocks,
        { id, type: "paragraph", attrs: {}, content: [{ kind: "text", text, marks: [] }] },
      ],
    }
  }
}

export const ReviewDialog = ({
  before,
  candidate,
  onClose,
  onAccept,
  provider = localSuggestions,
}: {
  readonly before: BlockDocument
  readonly candidate: BlockDocument
  readonly onClose: () => void
  readonly onAccept: (candidate: BlockDocument) => boolean | void
  readonly provider?: SuggestionProvider
}) => {
  const [candidateText, setCandidateText] = useState(() => JSON.stringify(candidate, null, 2))
  const [editingJson, setEditingJson] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [instruction, setInstruction] = useState(
    "다음 모임에서 이어서 나누고 싶은 주제를 적어 주세요.",
  )
  const [streaming, setStreaming] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)
  const stream = useRef(new SuggestionStream())
  const run = useRef(0)
  useEffect(() => () => stream.current.cancel(), [])
  const parsed = useMemo(() => {
    try {
      return { document: parseDocumentText(candidateText), error: null }
    } catch (caught) {
      return {
        document: null,
        error: caught instanceof Error ? caught.message : "JSON을 확인해 주세요",
      }
    }
  }, [candidateText])
  const changes = useMemo(
    () => (parsed.document === null ? [] : compareDocuments(before, parsed.document)),
    [before, parsed.document],
  )
  const selectedIds = selected ?? new Set(changes.map((change) => change.id))
  const accept = () => {
    if (parsed.document === null) {
      setError(parsed.error)
      return
    }
    const result = acceptChanges(before, {
      changes,
      selected: selectedIds,
      baseVersion: 0,
      currentVersion: 0,
    })
    if (result.kind !== "accepted") {
      setError("연결된 구조 변경을 함께 선택해 주세요.")
      return
    }
    if (onAccept(result.document) === false)
      setError("원본이 바뀌었습니다. 수정안을 복사해 보관한 뒤 최신 원본에서 다시 검토해 주세요.")
  }
  const generate = async () => {
    const generation = ++run.current
    setStreaming(true)
    setError(null)
    setSelected(null)
    setCandidateText(JSON.stringify(before, null, 2))
    try {
      await stream.current.start(provider, { document: before, instruction }, (value) =>
        setCandidateText(JSON.stringify(value, null, 2)),
      )
    } catch (caught) {
      if (generation === run.current)
        setError(caught instanceof Error ? caught.message : "수정안 생성 실패")
    } finally {
      if (generation === run.current) setStreaming(false)
    }
  }
  return (
    <DialogFrame titleId="review-title" eyebrow="REVIEW" title="수정안 비교" onClose={onClose} wide>
      <div className="button-row">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setEditingJson((value) => !value)}
        >
          {editingJson ? "문서 보기" : "후보 JSON 편집"}
        </button>
        <button
          className="button button--ghost"
          type="button"
          onClick={() => {
            run.current += 1
            stream.current.cancel()
            setStreaming(false)
          }}
          disabled={!streaming}
        >
          생성 중지
        </button>
      </div>
      <label className="field">
        <span>추가할 제안 문장</span>
        <input value={instruction} onChange={(event) => setInstruction(event.target.value)} />
      </label>
      <div className="button-row">
        <button
          type="button"
          className="button button--secondary"
          disabled={streaming || !instruction.trim()}
          onClick={() => void generate()}
        >
          문장으로 수정안 만들기
        </button>
        <small>
          기본 제공자는 입력 문장을 순차적으로 추가합니다. 외부 AI 제공자는 별도로 연결할 수
          있습니다.
        </small>
      </div>
      {editingJson ? (
        <div className="review-grid">
          <label className="field">
            <span>Before · 원본</span>
            <textarea readOnly value={JSON.stringify(before, null, 2)} rows={12} />
          </label>
          <label className="field">
            <span>After · 수정안</span>
            <textarea
              value={candidateText}
              rows={12}
              onChange={(event) => {
                run.current += 1
                stream.current.cancel()
                setStreaming(false)
                setCandidateText(event.target.value)
                setSelected(null)
                setError(null)
              }}
            />
          </label>
        </div>
      ) : (
        <div className="review-grid review-documents">
          <section>
            <h3>원본</h3>
            <BlockViewer content={before} />
          </section>
          <section>
            <h3>수정안</h3>
            {parsed.document && <BlockViewer content={parsed.document} />}
          </section>
        </div>
      )}
      <fieldset className="review-changes">
        <legend>적용할 변경</legend>
        {changes.map((change) => (
          <label key={change.id}>
            <input
              type="checkbox"
              checked={selectedIds.has(change.id)}
              disabled={streaming}
              onChange={(event) => {
                const next = new Set(selectedIds)
                if (event.target.checked) next.add(change.id)
                else next.delete(change.id)
                setSelected(next)
              }}
            />
            {change.before === null ? "추가" : change.after === null ? "삭제" : "수정"} ·{" "}
            {(change.after ?? change.before)?.content
              .map((inline) => (inline.kind === "text" ? inline.text : "첨부 콘텐츠"))
              .join("")
              .slice(0, 70) || change.blockId}
          </label>
        ))}
      </fieldset>
      {(error ?? parsed.error) && (
        <p className="form-error" role="alert">
          {error ?? parsed.error}
        </p>
      )}
      <footer>
        <button className="button button--ghost" type="button" onClick={onClose}>
          후보 폐기
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={accept}
          disabled={streaming || selectedIds.size === 0}
        >
          선택한 변경 수락
        </button>
      </footer>
    </DialogFrame>
  )
}

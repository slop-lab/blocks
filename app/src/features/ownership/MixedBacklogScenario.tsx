import type { BlockDocument } from "@block-editor/model"
import { BlockViewer } from "@block-editor/model/viewer"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CanonicalBlockEditor } from "./CustomNotesEditor"
import {
  changeTaskStatus,
  loadMixed,
  type MixedState,
  savePresentation,
  saveProposal,
} from "./mixed-api"
import { presentationProfile, presentationRenderers } from "./presentation-profile"

type Props = { readonly onOpenFiles: (path: string) => void }
export const MixedBacklogScenario = ({ onOpenFiles }: Props) => {
  const [state, setState] = useState<MixedState | null>(null)
  const [selected, setSelected] = useState("TASK-104")
  const [query, setQuery] = useState("")
  const [layer, setLayer] = useState<"presentation" | "proposal" | null>(null)
  const [draft, setDraft] = useState<BlockDocument | null>(null)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState("서버 상태를 불러오는 중입니다.")
  const generation = useRef(0)
  const refresh = useCallback(() => {
    const request = ++generation.current
    setMessage("서버 상태를 불러오는 중입니다.")
    void loadMixed()
      .then((next) => {
        if (request !== generation.current) return
        setState(next)
        setMessage("서버 상태와 동기화되었습니다.")
      })
      .catch((error: unknown) => {
        if (request === generation.current)
          setMessage(error instanceof Error ? error.message : "불러오지 못했습니다.")
      })
  }, [])
  useEffect(() => {
    refresh()
    return () => {
      generation.current += 1
    }
  }, [refresh])
  const task = state?.tasks.find((item) => item.id === selected) ?? state?.tasks[0]
  const filtered = useMemo(
    () =>
      state?.tasks.filter((item) =>
        `${item.id} ${item.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ) ?? [],
    [query, state],
  )
  const run = (operation: Promise<MixedState>, success: string) =>
    void operation
      .then((next) => {
        setState(next)
        setDirty(false)
        setMessage(success)
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "요청이 거절되었습니다."),
      )
  const openLayer = (kind: "presentation" | "proposal") => {
    if (state === null || task === undefined) return
    const document =
      kind === "presentation"
        ? state.presentations[task.id]
        : state.proposals.find((item) => item.taskId === task.id)?.document
    if (document !== undefined) {
      setLayer(kind)
      setDraft(document)
      setDirty(false)
    }
  }
  const changed = useCallback((document: BlockDocument) => {
    setDraft(document)
    setDirty(true)
  }, [])
  if (state === null || task === undefined)
    return (
      <div>
        <p role="status">{message}</p>
        <button type="button" onClick={refresh}>
          다시 시도
        </button>
      </div>
    )
  const root = {
    format: "block-editor/v0.3" as const,
    blocks: [
      {
        id: `root-${task.id}`,
        type: "ownership.task-card",
        attrs: { taskId: task.id },
        content: [{ kind: "text" as const, text: "서버 query가 선택한 읽기 전용 root", marks: [] }],
      },
    ],
  }
  return (
    <section className="ownership-scenario" aria-labelledby="mixed-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">MIXED OWNERSHIP</span>
          <h2 id="mixed-title">실행 작업 백로그</h2>
        </div>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => onOpenFiles(state.taskInfoFiles[task.id] ?? "")}
        >
          작업 Markdown 열기
        </button>
      </header>
      <div className="mixed-layout">
        <aside className="mixed-search">
          <label>
            작업 검색
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <h3>검색 결과</h3>
          {filtered.map((item) => (
            <button type="button" key={item.id} onClick={() => setSelected(item.id)}>
              {item.id} · {item.title}
            </button>
          ))}
          <h3>현재 실행 목록</h3>
          {state.tasks
            .filter((item) => item.status === "running")
            .map((item) => (
              <button type="button" key={item.id} onClick={() => setSelected(item.id)}>
                {item.title}
              </button>
            ))}
        </aside>
        <div>
          <BlockViewer
            content={root}
            renderers={presentationRenderers}
            viewData={new Map([[`root-${task.id}`, task]])}
          />
          <button
            className="button button--secondary"
            type="button"
            onClick={() =>
              run(changeTaskStatus(state, task), "도메인 workflow 상태를 변경했습니다.")
            }
          >
            서버 workflow 전환
          </button>
        </div>
        <aside className="mixed-lower-layer">
          <h3>독립 하위 원본</h3>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => openLayer("presentation")}
          >
            표현 편집
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => openLayer("proposal")}
          >
            제안 편집
          </button>
          {layer !== null && draft !== null && (
            <>
              <CanonicalBlockEditor
                key={`${layer}-${task.id}`}
                document={draft}
                onChange={changed}
                profile={presentationProfile}
                modelId={`mixed-${layer}-${task.id}`}
                label={layer === "presentation" ? "혼합 표현 편집기" : "에이전트 제안 편집기"}
              />
              <button
                className="button button--primary"
                disabled={!dirty}
                type="button"
                onClick={() =>
                  run(
                    layer === "presentation"
                      ? savePresentation(state, task.id, draft)
                      : saveProposal(state, "proposal-1", draft),
                    layer === "presentation"
                      ? "presentation BlockDocument를 저장했습니다."
                      : "의존 버전을 확인하고 proposal BlockDocument를 저장했습니다.",
                  )
                }
              >
                하위 문서 저장
              </button>
            </>
          )}
        </aside>
      </div>
      <footer role="status">{message}</footer>
    </section>
  )
}

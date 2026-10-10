import type { BlockRenderer } from "@block-editor/model"
import { BlockViewer } from "@block-editor/model/viewer"
import { useEffect, useState } from "react"
import {
  changeTaskStatus,
  loadMixed,
  type MixedState,
  savePresentation,
  saveProposal,
} from "./mixed-api"

const taskRenderer: BlockRenderer = (block, data) => {
  const task = typeof data === "object" && data !== null && "title" in data ? data : null
  return (
    <article className="mixed-task">
      <h3>{task === null ? "작업 없음" : String(task.title)}</h3>
      <p>{String(block.attrs["caption"] ?? "")}</p>
      <small>{task === null || !("status" in task) ? "unknown" : String(task.status)}</small>
    </article>
  )
}

export const MixedBacklogScenario = ({ onOpenFiles }: { readonly onOpenFiles: () => void }) => {
  const [state, setState] = useState<MixedState | null>(null)
  const [selected, setSelected] = useState("TASK-104")
  const [caption, setCaption] = useState("")
  const [proposal, setProposal] = useState("")
  const [message, setMessage] = useState("서버 상태를 불러오는 중입니다.")
  const refresh = () =>
    void loadMixed().then((next) => {
      setState(next)
      setCaption(next.presentation[selected] ?? "")
      setProposal(next.proposals[0]?.draft ?? "")
      setMessage("서버 상태와 동기화되었습니다.")
    })
  useEffect(refresh, [selected])
  if (state === null) return <p role="status">{message}</p>
  const task = state.tasks.find((item) => item.id === selected) ?? state.tasks[0]
  if (task === undefined) return <p role="status">표시할 작업이 없습니다.</p>
  const document = {
    format: "block-editor/v0.3" as const,
    blocks: [
      {
        id: `root-${task.id}`,
        type: "mixed.task",
        attrs: { caption: state.presentation[task.id] ?? "" },
        content: [],
      },
    ],
  }
  const run = (operation: Promise<MixedState>, success: string) =>
    void operation
      .then((next) => {
        setState(next)
        setMessage(success)
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "요청이 거절되었습니다.")
      })
  return (
    <section className="ownership-scenario" aria-labelledby="mixed-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">MIXED OWNERSHIP</span>
          <h2 id="mixed-title">실행 작업 백로그</h2>
        </div>
        <button className="button button--secondary" type="button" onClick={onOpenFiles}>
          작업 Markdown 열기
        </button>
      </header>
      <div className="mixed-layout">
        <aside className="mixed-search">
          <label>
            작업 검색
            <input value={selected} onChange={(event) => setSelected(event.target.value)} />
          </label>
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
            content={document}
            renderers={new Map([["mixed.task", taskRenderer]])}
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
          <h3>하위 presentation</h3>
          <label>
            카드 캡션
            <input value={caption} onChange={(event) => setCaption(event.target.value)} />
          </label>
          <button
            className="button button--primary"
            type="button"
            onClick={() =>
              run(savePresentation(state, task.id, caption), "presentation만 저장했습니다.")
            }
          >
            캡션 저장
          </button>
          <h3>에이전트 제안</h3>
          <label>
            제안 초안
            <textarea value={proposal} onChange={(event) => setProposal(event.target.value)} />
          </label>
          <button
            className="button button--primary"
            type="button"
            onClick={() =>
              run(
                saveProposal(state, "proposal-1", proposal),
                "의존 버전을 확인하고 제안을 저장했습니다.",
              )
            }
          >
            제안 저장
          </button>
        </aside>
      </div>
      <footer role="status">
        {message} 작업 정보: {state.taskInfoFile}
      </footer>
    </section>
  )
}

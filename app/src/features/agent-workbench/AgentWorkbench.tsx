import { CheckCircledIcon, Cross2Icon, FileTextIcon, RowsIcon } from "@radix-ui/react-icons"
import { useEffect, useMemo, useRef, useState } from "react"
import { AgentModelSelect } from "./AgentModelSelect"
import {
  type AgentOperation,
  type AgentRun,
  commandAgent,
  getAgentRun,
  loadAgentResources,
  startAgent,
} from "./agent-api"

type Story = "markdown" | "workspace" | "mixed"

const stories = {
  markdown: { label: "Markdown", detail: "검색 · 범위 읽기 · 정확한 교체", icon: FileTextIcon },
  workspace: { label: "데이터베이스", detail: "행 조회 · 상태 셀 패치", icon: RowsIcon },
  mixed: { label: "혼합 백로그", detail: "작업 · 근거 · 실행 계획", icon: CheckCircledIcon },
} as const

export const AgentWorkbench = () => {
  const [story, setStory] = useState<Story>("markdown")
  const [resources, setResources] = useState<Awaited<ReturnType<typeof loadAgentResources>> | null>(
    null,
  )
  const [selected, setSelected] = useState("")
  const [instruction, setInstruction] = useState("검토 근거를 명확한 다음 단계로 정리해 주세요.")
  const [inferenceModel, setInferenceModel] = useState<string>()
  const [operation, setOperation] = useState<AgentOperation | null>(null)
  const [run, setRun] = useState<AgentRun | null>(null)
  const [message, setMessage] = useState("")
  const polling = useRef(true)

  useEffect(() => {
    void loadAgentResources()
      .then(setResources)
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "리소스를 불러오지 못했습니다"),
      )
  }, [])
  const choices = useMemo(() => {
    if (resources === null) return []
    switch (story) {
      case "markdown":
        return resources.markdown.map((file) => ({ id: file, label: file }))
      case "workspace":
        return resources.databases.map((database) => ({
          id: database.documentId,
          label: database.content.name,
        }))
      case "mixed":
        return (resources.tasks?.tasks ?? [])
          .filter((task) => task.status === "running")
          .map((task) => ({ id: task.id, label: `${task.id} · ${task.title}` }))
      default:
        return story satisfies never
    }
  }, [resources, story])
  const resourceError = resources?.errors[story]
  const resourceId = choices.some((choice) => choice.id === selected)
    ? selected
    : (choices[0]?.id ?? "")

  useEffect(() => {
    if (operation === null || !polling.current) return
    let active = true
    const refresh = async () => {
      const next = await getAgentRun(operation)
      if (!active) return
      setRun(next)
      if (next.status === "pending" || next.status === "running")
        window.setTimeout(() => void refresh(), 150)
    }
    void refresh().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "실행 상태를 읽지 못했습니다"),
    )
    return () => {
      active = false
    }
  }, [operation])

  const begin = async () => {
    if (resources === null || resourceId.length === 0 || resourceError !== undefined) return
    polling.current = true
    setRun(null)
    setMessage("")
    const selectedTask = resources.tasks?.tasks.find((task) => task.id === resourceId)
    const target =
      story === "markdown"
        ? { modelId: "markdown-git", resourceId, epoch: 1, baseVersion: 1 }
        : story === "workspace"
          ? { modelId: "structured-workspace", resourceId, epoch: 1, baseVersion: 1 }
          : resources.tasks === null || selectedTask === undefined
            ? null
            : {
                modelId: "mixed-backlog",
                taskId: resourceId,
                dependencyVersion: selectedTask.version,
                epoch: 1,
                baseVersion: resources.tasks.revision,
              }
    if (target === null) return
    setOperation(
      await startAgent({
        instruction,
        target,
        ...(inferenceModel === undefined ? {} : { inferenceModel }),
      }),
    )
  }

  const apply = async () => {
    if (operation === null) return
    await commandAgent(operation, "apply")
    const next = await getAgentRun(operation)
    setRun(next)
    setMessage(
      next.application === "applied"
        ? "검토한 변경을 원본에 저장했습니다."
        : "원본이 바뀌어 적용하지 않았습니다.",
    )
    setResources(await loadAgentResources())
  }

  return (
    <section className="agent-workbench" aria-labelledby="agent-workbench-title">
      <header className="agent-workbench__header">
        <div>
          <p className="eyebrow">PART-POWERED WORKBENCH</p>
          <h1 id="agent-workbench-title">에이전트 도구 예제</h1>
          <p>
            원본을 읽는 도구와 변경을 제안하는 도구를 분리하고, 검토한 정확한 작업만 CAS로
            적용합니다.
          </p>
        </div>
        <span className="status-badge">{run?.providerLabel ?? "실행 모델 선택 대기"}</span>
      </header>
      <div className="agent-story-tabs" role="tablist" aria-label="에이전트 워크플로">
        {(Object.entries(stories) as [Story, (typeof stories)[Story]][]).map(([id, item]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={story === id}
            className={story === id ? "agent-story-tab agent-story-tab--active" : "agent-story-tab"}
            onClick={() => {
              setStory(id)
              setSelected("")
              setOperation(null)
              setRun(null)
              setMessage("")
            }}
          >
            <item.icon />
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="agent-workbench__grid">
        <section className="agent-control-panel" aria-label="실행 설정">
          <AgentModelSelect
            value={inferenceModel}
            onChange={setInferenceModel}
            disabled={run?.status === "running"}
          />
          <label className="field">
            <span>권한 있는 원본</span>
            <select
              value={resourceId}
              disabled={resources === null || resourceError !== undefined || choices.length === 0}
              onChange={(event) => setSelected(event.target.value)}
            >
              {resources === null && <option>리소스 불러오는 중</option>}
              {resources !== null && resourceError === undefined && choices.length === 0 && (
                <option>사용 가능한 원본 없음</option>
              )}
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          {resourceError !== undefined && (
            <p className="agent-message agent-message--warning" role="alert">
              {stories[story].label} 리소스를 불러오지 못했습니다. {resourceError}
            </p>
          )}
          <label className="field">
            <span>요청</span>
            <textarea
              rows={5}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              disabled={
                resourceId.length === 0 ||
                resourceError !== undefined ||
                instruction.trim().length === 0 ||
                run?.status === "running"
              }
              onClick={() => void begin()}
            >
              실행 시작
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={operation === null || run?.status !== "running"}
              onClick={() => operation && void commandAgent(operation, "cancel")}
            >
              취소
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={operation === null}
              onClick={() => {
                polling.current = false
                setMessage("관찰만 분리했습니다. 서버 실행은 계속됩니다.")
              }}
            >
              관찰 분리
            </button>
          </div>
          {run && (
            <dl className="agent-run-meta">
              <div>
                <dt>상태</dt>
                <dd>{run.status}</dd>
              </div>
              <div>
                <dt>적용</dt>
                <dd>{run.application}</dd>
              </div>
              <div>
                <dt>실행 ID</dt>
                <dd>{run.id}</dd>
              </div>
            </dl>
          )}
        </section>
        <section className="agent-review-panel" aria-label="검토 아티팩트">
          <div className="agent-panel-heading">
            <div>
              <p className="eyebrow">EXACT REVIEW</p>
              <h2>변경 검토</h2>
            </div>
            {run?.artifact && (
              <span className="status-badge status-badge--success">fingerprint 고정</span>
            )}
          </div>
          {run?.artifact ? (
            <>
              <dl className="agent-artifact">
                <div>
                  <dt>작업 종류</dt>
                  <dd>{run.artifact.kind}</dd>
                </div>
                <div>
                  <dt>Before</dt>
                  <dd>
                    <pre>{JSON.stringify(run.artifact.before, null, 2)}</pre>
                  </dd>
                </div>
                <div>
                  <dt>After</dt>
                  <dd>
                    <pre>{JSON.stringify(run.artifact.after, null, 2)}</pre>
                  </dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd>
                    <code>{run.artifact.fingerprint}</code>
                  </dd>
                </div>
              </dl>
              <div className="button-row">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={run.status !== "completed" || run.application !== "not-requested"}
                  onClick={() => void apply()}
                >
                  검토한 작업 적용
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => {
                    setOperation(null)
                    setRun(null)
                    setMessage("아티팩트를 폐기했습니다.")
                  }}
                >
                  <Cross2Icon /> 거절
                </button>
              </div>
            </>
          ) : (
            <p className="agent-empty">
              실행이 끝나면 정확한 before/after와 fingerprint가 여기에 표시됩니다.
            </p>
          )}
        </section>
      </div>
      <section className="agent-timeline" aria-label="도구 타임라인">
        <div className="agent-panel-heading">
          <h2>도구 타임라인</h2>
          <small>{run?.events.length ?? 0} events</small>
        </div>
        <ol>
          {run?.events.map((event) => (
            <li key={event.id}>
              <span className="agent-event-index">{event.id}</span>
              <div>
                <strong>{event.type}</strong>
                <p>{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {message && (
        <p
          className={
            run?.application === "conflict"
              ? "agent-message agent-message--warning"
              : "agent-message"
          }
          role="status"
        >
          {message}
        </p>
      )}
    </section>
  )
}

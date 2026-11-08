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
  markdown: {
    label: "Markdown",
    detail: "Search · ranged reads · exact replacements",
    icon: FileTextIcon,
  },
  workspace: { label: "Database", detail: "Row queries · status cell patches", icon: RowsIcon },
  mixed: {
    label: "Mixed backlog",
    detail: "Tasks · evidence · execution plans",
    icon: CheckCircledIcon,
  },
} as const

export const AgentWorkbench = () => {
  const [story, setStory] = useState<Story>("markdown")
  const [resources, setResources] = useState<Awaited<ReturnType<typeof loadAgentResources>> | null>(
    null,
  )
  const [selected, setSelected] = useState("")
  const [instruction, setInstruction] = useState("Turn the review evidence into clear next steps.")
  const [inferenceModel, setInferenceModel] = useState<string>()
  const [operation, setOperation] = useState<AgentOperation | null>(null)
  const [run, setRun] = useState<AgentRun | null>(null)
  const [message, setMessage] = useState("")
  const polling = useRef(true)

  useEffect(() => {
    void loadAgentResources()
      .then(setResources)
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "Could not load resources"),
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
      setMessage(error instanceof Error ? error.message : "Could not read run status"),
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
        ? "Saved the reviewed changes to the source."
        : "The source changed, so the changes were not applied.",
    )
    setResources(await loadAgentResources())
  }

  return (
    <section className="agent-workbench" aria-labelledby="agent-workbench-title">
      <header className="agent-workbench__header">
        <div>
          <p className="eyebrow">PART-POWERED WORKBENCH</p>
          <h1 id="agent-workbench-title">Agent tools examples</h1>
          <p>
            Separate tools that read the source from tools that propose changes, then apply only the
            exact reviewed operation through CAS.
          </p>
        </div>
        <span className="status-badge">{run?.providerLabel ?? "Waiting for a run model"}</span>
      </header>
      <div className="agent-story-tabs" role="tablist" aria-label="Agent workflow">
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
        <section className="agent-control-panel" aria-label="Run settings">
          <AgentModelSelect
            value={inferenceModel}
            onChange={setInferenceModel}
            disabled={run?.status === "running"}
          />
          <label className="field">
            <span>Authorized source</span>
            <select
              value={resourceId}
              disabled={resources === null || resourceError !== undefined || choices.length === 0}
              onChange={(event) => setSelected(event.target.value)}
            >
              {resources === null && <option>Loading resources</option>}
              {resources !== null && resourceError === undefined && choices.length === 0 && (
                <option>No sources available</option>
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
              Could not load the {stories[story].label} resources. {resourceError}
            </p>
          )}
          <label className="field">
            <span>Request</span>
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
              Start run
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={operation === null || run?.status !== "running"}
              onClick={() => operation && void commandAgent(operation, "cancel")}
            >
              Cancel
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={operation === null}
              onClick={() => {
                polling.current = false
                setMessage("Detached the observer. The server run is still in progress.")
              }}
            >
              Detach observer
            </button>
          </div>
          {run && (
            <dl className="agent-run-meta">
              <div>
                <dt>Status</dt>
                <dd>{run.status}</dd>
              </div>
              <div>
                <dt>Apply</dt>
                <dd>{run.application}</dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd>{run.id}</dd>
              </div>
            </dl>
          )}
        </section>
        <section className="agent-review-panel" aria-label="Review artifact">
          <div className="agent-panel-heading">
            <div>
              <p className="eyebrow">EXACT REVIEW</p>
              <h2>Review changes</h2>
            </div>
            {run?.artifact && (
              <span className="status-badge status-badge--success">Fingerprint locked</span>
            )}
          </div>
          {run?.artifact ? (
            <>
              <dl className="agent-artifact">
                <div>
                  <dt>Operation type</dt>
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
                  Apply reviewed operation
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => {
                    setOperation(null)
                    setRun(null)
                    setMessage("Discarded the artifact.")
                  }}
                >
                  <Cross2Icon /> Reject
                </button>
              </div>
            </>
          ) : (
            <p className="agent-empty">
              The exact before and after values and fingerprint will appear here when the run
              finishes.
            </p>
          )}
        </section>
      </div>
      <section className="agent-timeline" aria-label="Tool timeline">
        <div className="agent-panel-heading">
          <h2>Tool timeline</h2>
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

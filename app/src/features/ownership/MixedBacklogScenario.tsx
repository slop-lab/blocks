import type { BlockDocument } from "@slop-lab/blocks"
import { BlockViewer } from "@slop-lab/blocks/viewer"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MixedLowerLayer } from "./MixedLowerLayer"
import {
  changeTaskStatus,
  type LowerDraft,
  loadMixed,
  type MixedState,
  savePresentation,
  saveProposal,
} from "./mixed-api"
import { presentationRenderers } from "./presentation-profile"
import { useMixedAgent } from "./useMixedAgent"

type Props = { readonly onOpenFiles: (path: string) => void }
export const MixedBacklogScenario = ({ onOpenFiles }: Props) => {
  const [state, setState] = useState<MixedState | null>(null)
  const [selected, setSelected] = useState("TASK-104")
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState<LowerDraft | null>(null)
  const [pending, setPending] = useState<"domain" | "draft" | null>(null)
  const [message, setMessage] = useState("Loading server state.")
  const generation = useRef(0)
  const refresh = useCallback(() => {
    const request = ++generation.current
    setMessage("Loading server state.")
    void loadMixed()
      .then((next) => {
        if (request !== generation.current) return
        setState(next)
        setMessage("Synchronized with server state.")
      })
      .catch((error: unknown) => {
        if (request === generation.current)
          setMessage(error instanceof Error ? error.message : "Could not load the data.")
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
  const mergeState = (next: MixedState) =>
    setState((current) => (current === null || next.revision > current.revision ? next : current))
  const agent = useMixedAgent({
    state,
    task,
    onState: mergeState,
    onDraft: setDraft,
    onMessage: setMessage,
  })
  const busy = pending !== null || agent.running
  const runDomain = (operation: () => Promise<MixedState>, success: string) => {
    if (pending !== null) return
    setPending("domain")
    void operation()
      .then((next) => {
        mergeState(next)
        setMessage(success)
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "The request was rejected."),
      )
      .finally(() => setPending(null))
  }
  const openLayer = (kind: "presentation" | "proposal") => {
    if (state === null || task === undefined) return
    if (draft !== null && draft.editVersion > 0) {
      setMessage("Save or cancel the current child document before opening another editor.")
      return
    }
    const document =
      kind === "presentation"
        ? state.presentations[task.id]
        : state.proposals.find((item) => item.taskId === task.id)?.document
    if (document !== undefined) {
      const proposal = state.proposals.find((item) => item.taskId === task.id)
      setDraft({
        target: {
          taskId: task.id,
          layer: kind,
          proposalId: kind === "proposal" ? (proposal?.id ?? null) : null,
          expectedRevision: state.revision,
          dependencyVersion: kind === "proposal" ? (proposal?.dependencyVersion ?? null) : null,
        },
        document,
        editVersion: 0,
      })
    }
  }
  const changed = useCallback((document: BlockDocument) => {
    setDraft((current) =>
      current === null ? null : { ...current, document, editVersion: current.editVersion + 1 },
    )
  }, [])
  const saveDraft = () => {
    if (draft === null || draft.editVersion === 0 || pending !== null) return
    const submitted = draft
    const operation =
      submitted.target.layer === "presentation"
        ? savePresentation(
            submitted.target.expectedRevision,
            submitted.target.taskId,
            submitted.document,
          )
        : submitted.target.proposalId !== null && submitted.target.dependencyVersion !== null
          ? saveProposal(
              submitted.target.expectedRevision,
              submitted.target.proposalId,
              submitted.target.taskId,
              submitted.target.dependencyVersion,
              submitted.document,
            )
          : null
    if (operation === null) return
    setPending("draft")
    void operation
      .then((next) => {
        mergeState(next)
        setDraft((current) =>
          current?.target === submitted.target && current.editVersion === submitted.editVersion
            ? {
                ...current,
                editVersion: 0,
                target: { ...current.target, expectedRevision: next.revision },
              }
            : current,
        )
        setMessage(
          submitted.target.layer === "presentation"
            ? "Saved the presentation BlockDocument."
            : "Verified the dependency version and saved the proposal BlockDocument.",
        )
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "The request was rejected."),
      )
      .finally(() => setPending(null))
  }
  if (state === null || task === undefined)
    return (
      <div>
        <p role="status">{message}</p>
        <button type="button" onClick={refresh}>
          Try again
        </button>
      </div>
    )
  const presentation = state.presentations[task.id]
  const proposals = state.proposals.filter((item) => item.taskId === task.id)
  return (
    <section className="ownership-scenario" aria-labelledby="mixed-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">MIXED OWNERSHIP</span>
          <h2 id="mixed-title">Execution task backlog</h2>
        </div>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => onOpenFiles(state.taskInfoFiles[task.id] ?? "")}
        >
          Open task Markdown
        </button>
      </header>
      <div className="mixed-layout">
        <aside className="mixed-search">
          <label>
            Search tasks
            <input
              value={query}
              placeholder="Task name or TASK-104"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <h3>Search results</h3>
          {filtered.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={agent.running}
              onClick={() => setSelected(item.id)}
            >
              {item.id} · {item.title}
            </button>
          ))}
          <h3>Current run list</h3>
          {state.tasks
            .filter((item) => item.status === "running")
            .map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={agent.running}
                onClick={() => setSelected(item.id)}
              >
                {item.title}
              </button>
            ))}
        </aside>
        <div>
          {presentation !== undefined && (
            <BlockViewer
              content={presentation}
              renderers={presentationRenderers}
              viewData={new Map(presentation.blocks.map((block) => [block.id, task]))}
            />
          )}
          {proposals.map((proposal) => (
            <section key={proposal.id} aria-label={`Proposal ${proposal.id}`}>
              <BlockViewer content={proposal.document} renderers={presentationRenderers} />
            </section>
          ))}
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              runDomain(() => changeTaskStatus(state, task), "Updated the domain workflow state.")
            }
          >
            {pending === "domain" ? "Transitioning" : "Transition server workflow"}
          </button>
          {agent.running ? (
            <button className="button button--ghost" type="button" onClick={agent.cancel}>
              Cancel agent run
            </button>
          ) : (
            <button
              className="button button--secondary"
              type="button"
              disabled={busy || (draft !== null && draft.editVersion > 0)}
              onClick={() => void agent.run()}
            >
              Run agent proposal
            </button>
          )}
        </div>
        <MixedLowerLayer
          draft={draft}
          pending={busy}
          saving={pending === "draft"}
          onOpen={openLayer}
          onChange={changed}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      </div>
      <footer role="status">{message}</footer>
    </section>
  )
}

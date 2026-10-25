import { useEffect, useMemo, useRef, useState } from "react"
import { createAgentSuggestionProvider } from "../core/agent-suggestions"
import { parseDocumentText } from "../core/codec"
import type { SuggestionProvider } from "../core/proposals"
import { acceptChanges, compareDocuments, SuggestionStream } from "../core/proposals"
import type { BlockDocument } from "../core/types"
import { AgentModelSelect } from "../features/agent-workbench/AgentModelSelect"
import { BlockViewer } from "../Viewer"
import { DialogFrame } from "./DialogFrame"

export const ReviewDialog = ({
  before,
  candidate,
  onClose,
  onAccept,
  target,
  provider,
}: {
  readonly before: BlockDocument
  readonly candidate: BlockDocument
  readonly onClose: () => void
  readonly onAccept: (candidate: BlockDocument) => boolean | undefined
  readonly target?: {
    readonly modelId: string
    readonly epoch: number
    readonly baseVersion: number
  }
  readonly provider?: SuggestionProvider
}) => {
  const [candidateText, setCandidateText] = useState(() => JSON.stringify(candidate, null, 2))
  const [editingJson, setEditingJson] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [instruction, setInstruction] = useState(
    "Add a topic you would like to continue discussing at the next meeting.",
  )
  const [streaming, setStreaming] = useState(false)
  const [inferenceModel, setInferenceModel] = useState<string>()
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)
  const stream = useRef(new SuggestionStream())
  const run = useRef(0)
  const suggestionProvider = useMemo(
    () =>
      provider ??
      createAgentSuggestionProvider(
        target ?? { modelId: "review", epoch: 0, baseVersion: 0 },
        "proposal",
        inferenceModel,
      ),
    [provider, target, inferenceModel],
  )
  useEffect(() => () => stream.current.cancel("observer-detach"), [])
  const parsed = useMemo(() => {
    try {
      return { document: parseDocumentText(candidateText), error: null }
    } catch (caught) {
      return {
        document: null,
        error: caught instanceof Error ? caught.message : "Check the JSON and try again",
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
      setError("Select the related structural changes together.")
      return
    }
    if (onAccept(result.document) === false)
      setError(
        "The source changed. Copy the revision for safekeeping, then review it again against the latest source.",
      )
  }
  const generate = async () => {
    const generation = ++run.current
    setStreaming(true)
    setError(null)
    setSelected(null)
    setCandidateText(JSON.stringify(before, null, 2))
    try {
      await stream.current.start(suggestionProvider, { document: before, instruction }, (value) =>
        setCandidateText(JSON.stringify(value, null, 2)),
      )
    } catch (caught) {
      if (generation === run.current)
        setError(caught instanceof Error ? caught.message : "Failed to generate revision")
    } finally {
      if (generation === run.current) setStreaming(false)
    }
  }
  return (
    <DialogFrame
      titleId="review-title"
      eyebrow="REVIEW"
      title="Compare revision"
      onClose={onClose}
      wide
    >
      <div className="button-row">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setEditingJson((value) => !value)}
        >
          {editingJson ? "View documents" : "Edit candidate JSON"}
        </button>
        <button
          className="button button--ghost"
          type="button"
          onClick={() => {
            run.current += 1
            stream.current.cancel("execution-cancel")
            setStreaming(false)
          }}
          disabled={!streaming}
        >
          Stop generating
        </button>
      </div>
      <label className="field">
        <span>Revision instruction</span>
        <input value={instruction} onChange={(event) => setInstruction(event.target.value)} />
      </label>
      {provider === undefined && (
        <AgentModelSelect
          value={inferenceModel}
          onChange={setInferenceModel}
          disabled={streaming}
        />
      )}
      <div className="button-row">
        <button
          type="button"
          className="button button--secondary"
          disabled={streaming || !instruction.trim()}
          onClick={() => void generate()}
        >
          Generate revision
        </button>
        <small>
          A server-side Part task generates the candidate. If no model is connected, it is clearly
          identified as a deterministic scenario / model unavailable.
        </small>
      </div>
      {editingJson ? (
        <div className="review-grid">
          <label className="field">
            <span>Before · Source</span>
            <textarea readOnly value={JSON.stringify(before, null, 2)} rows={12} />
          </label>
          <label className="field">
            <span>After · Revision</span>
            <textarea
              value={candidateText}
              rows={12}
              onChange={(event) => {
                run.current += 1
                stream.current.cancel("execution-cancel")
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
            <h3>Source</h3>
            <BlockViewer content={before} />
          </section>
          <section>
            <h3>Revision</h3>
            {parsed.document && <BlockViewer content={parsed.document} />}
          </section>
        </div>
      )}
      <fieldset className="review-changes">
        <legend>Changes to apply</legend>
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
            {change.before === null ? "Add" : change.after === null ? "Delete" : "Edit"} ·{" "}
            {(change.after ?? change.before)?.content
              .map((inline) => (inline.kind === "text" ? inline.text : "Attached content"))
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
          Discard candidate
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={accept}
          disabled={streaming || selectedIds.size === 0}
        >
          Accept selected changes
        </button>
      </footer>
    </DialogFrame>
  )
}

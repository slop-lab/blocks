import { useEffect, useId, useState } from "react"
import { type AgentModelCatalog, loadAgentModels } from "./agent-api"

type AgentModelSelectProps = {
  readonly value: string | undefined
  readonly onChange: (modelId: string | undefined) => void
  readonly disabled?: boolean
}

export const AgentModelSelect = ({ value, onChange, disabled }: AgentModelSelectProps) => {
  const [catalog, setCatalog] = useState<AgentModelCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const selected = catalog?.models.find((model) => model.id === value)

  useEffect(() => {
    let active = true
    void loadAgentModels()
      .then((next) => {
        if (!active) return
        setCatalog(next)
        onChange(next.defaultModel ?? next.models[0]?.id)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : "Could not load the model list.")
      })
    return () => {
      active = false
    }
  }, [onChange])

  return (
    <div className="field">
      <label htmlFor={id}>Run model</label>
      <select
        id={id}
        aria-describedby={selected === undefined ? undefined : `${id}-details`}
        value={value ?? ""}
        disabled={disabled || catalog === null || catalog.models.length === 0}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        {catalog === null && <option value="">Loading models</option>}
        {catalog?.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
          </option>
        ))}
      </select>
      {selected !== undefined && (
        <small className="agent-model-details" id={`${id}-details`}>
          <span>{selected.providerLabel}</span>
          <code>{selected.id}</code>
        </small>
      )}
      {error !== null && <small className="form-error">{error}</small>}
    </div>
  )
}

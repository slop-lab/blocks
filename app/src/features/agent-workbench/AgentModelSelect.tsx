import { useEffect, useState } from "react"
import { type AgentModelCatalog, loadAgentModels } from "./agent-api"

type AgentModelSelectProps = {
  readonly value: string | undefined
  readonly onChange: (modelId: string | undefined) => void
  readonly disabled?: boolean
}

export const AgentModelSelect = ({ value, onChange, disabled }: AgentModelSelectProps) => {
  const [catalog, setCatalog] = useState<AgentModelCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        setError(caught instanceof Error ? caught.message : "모델 목록을 불러오지 못했습니다.")
      })
    return () => {
      active = false
    }
  }, [onChange])

  return (
    <label className="field">
      <span>실행 모델</span>
      <select
        value={value ?? ""}
        disabled={disabled || catalog === null || catalog.models.length === 0}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        {catalog === null && <option value="">모델 목록 불러오는 중</option>}
        {catalog?.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.providerLabel} · {model.id}
          </option>
        ))}
      </select>
      {error !== null && <small className="form-error">{error}</small>}
    </label>
  )
}

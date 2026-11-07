import type { BlockRenderer } from "@slop-lab/blocks"
import { BlockViewer } from "@slop-lab/blocks/viewer"
import { useMemo, useState } from "react"

const statusRenderer: BlockRenderer = (block, data) => {
  const record =
    typeof data === "object" && data !== null && "status" in data ? data : { status: "unknown" }
  return (
    <section className="ownership-projection">
      <h3>{String(block.attrs["label"] ?? "Status")}</h3>
      <strong>{String(record.status)}</strong>
    </section>
  )
}

export const StatusViewScenario = () => {
  const [status, setStatus] = useState("Under review")
  const document = useMemo(
    () => ({
      format: "block-editor/v0.3" as const,
      blocks: [
        {
          id: "release",
          type: "status.projection",
          attrs: { label: "Mobile release" },
          content: [],
        },
        {
          id: "quality",
          type: "status.projection",
          attrs: { label: "Quality check" },
          content: [],
        },
      ],
    }),
    [],
  )
  const viewData = new Map([
    ["release", { status }],
    ["quality", { status: "Passed" }],
  ])
  return (
    <section className="ownership-scenario" aria-labelledby="status-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">DOMAIN PROJECTION</span>
          <h2 id="status-title">Release status view</h2>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() =>
            setStatus((value) => (value === "Under review" ? "Approved" : "Under review"))
          }
        >
          Toggle server status
        </button>
      </header>
      <p className="ownership-explainer">
        Query result order and status determine the screen. This tab does not create an editor or
        native editing controls.
      </p>
      <BlockViewer
        content={document}
        renderers={new Map([["status.projection", statusRenderer]])}
        viewData={viewData}
      />
    </section>
  )
}

import type { BlockRenderer } from "@block-editor/model"
import { BlockViewer } from "@block-editor/model/viewer"
import { useMemo, useState } from "react"

const statusRenderer: BlockRenderer = (block, data) => {
  const record =
    typeof data === "object" && data !== null && "status" in data ? data : { status: "unknown" }
  return (
    <section className="ownership-projection">
      <h3>{String(block.attrs["label"] ?? "상태")}</h3>
      <strong>{String(record.status)}</strong>
    </section>
  )
}

export const StatusViewScenario = () => {
  const [status, setStatus] = useState("검토 중")
  const document = useMemo(
    () => ({
      format: "block-editor/v0.3" as const,
      blocks: [
        { id: "release", type: "status.projection", attrs: { label: "모바일 출시" }, content: [] },
        { id: "quality", type: "status.projection", attrs: { label: "품질 점검" }, content: [] },
      ],
    }),
    [],
  )
  const viewData = new Map([
    ["release", { status }],
    ["quality", { status: "통과" }],
  ])
  return (
    <section className="ownership-scenario" aria-labelledby="status-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">DOMAIN PROJECTION</span>
          <h2 id="status-title">출시 상태 보기</h2>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => setStatus((value) => (value === "검토 중" ? "승인됨" : "검토 중"))}
        >
          서버 상태 전환
        </button>
      </header>
      <p className="ownership-explainer">
        쿼리 결과의 순서와 상태가 화면을 결정합니다. 이 탭은 editor나 네이티브 편집 컨트롤을 만들지
        않습니다.
      </p>
      <BlockViewer
        content={document}
        renderers={new Map([["status.projection", statusRenderer]])}
        viewData={viewData}
      />
    </section>
  )
}

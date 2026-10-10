import { useState } from "react"
import { MarkdownWorkspace } from "../markdown/MarkdownWorkspace"
import { MixedBacklogScenario } from "./MixedBacklogScenario"
import { NotebookScenario } from "./NotebookScenario"
import { ProjectBoardScenario } from "./ProjectBoardScenario"
import { StatusViewScenario } from "./StatusViewScenario"
import "./ownership.css"

const tabs = [
  { id: "notebook", label: "노트북" },
  { id: "projectboard", label: "프로젝트 보드" },
  { id: "statusview", label: "상태 보기" },
  { id: "filetree", label: "파일 트리" },
  { id: "mixedbacklog", label: "혼합 백로그" },
] as const
type Tab = (typeof tabs)[number]["id"]

export const OwnershipExamplesWorkspace = () => {
  const [tab, setTab] = useState<Tab>("notebook")
  return (
    <section className="ownership-workspace">
      <header className="ownership-workspace__header">
        <span className="eyebrow">OWNERSHIP EXAMPLES</span>
        <h1>누가 원본을 소유하는가</h1>
        <p>같은 블록 표면을 다섯 가지 소유권 경계로 구성한 실제 동작 예제입니다.</p>
      </header>
      <nav className="ownership-tabs" aria-label="소유권 예제">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="ownership-workspace__body">
        {tab === "notebook" && <NotebookScenario />}
        {tab === "projectboard" && <ProjectBoardScenario />}
        {tab === "statusview" && <StatusViewScenario />}
        {tab === "filetree" && <MarkdownWorkspace />}
        {tab === "mixedbacklog" && <MixedBacklogScenario onOpenFiles={() => setTab("filetree")} />}
      </div>
    </section>
  )
}

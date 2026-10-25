import { useState } from "react"
import { MarkdownWorkspace } from "../markdown/MarkdownWorkspace"
import { MixedBacklogScenario } from "./MixedBacklogScenario"
import { NotebookScenario } from "./NotebookScenario"
import { ProjectBoardScenario } from "./ProjectBoardScenario"
import { StatusViewScenario } from "./StatusViewScenario"
import "./ownership.css"

const tabs = [
  { id: "notebook", label: "Notebook" },
  { id: "projectboard", label: "Project board" },
  { id: "statusview", label: "Status view" },
  { id: "filetree", label: "File tree" },
  { id: "mixedbacklog", label: "Mixed backlog" },
] as const
type Tab = (typeof tabs)[number]["id"]

export const OwnershipExamplesWorkspace = () => {
  const [tab, setTab] = useState<Tab>("notebook")
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(new Set(["notebook"]))
  const [file, setFile] = useState<string | null>(null)
  return (
    <section className="ownership-workspace">
      <header className="ownership-workspace__header">
        <span className="eyebrow">OWNERSHIP EXAMPLES</span>
        <h1>Who owns the source?</h1>
        <p>
          A working example of the same block surface configured with five ownership boundaries.
        </p>
      </header>
      <nav className="ownership-tabs" aria-label="Ownership examples">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => {
              setTab(item.id)
              setVisited((current) => new Set([...current, item.id]))
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="ownership-workspace__body">
        <div hidden={tab !== "notebook"}>
          <NotebookScenario />
        </div>
        <div hidden={tab !== "projectboard"}>
          {visited.has("projectboard") && <ProjectBoardScenario />}
        </div>
        <div hidden={tab !== "statusview"}>
          {visited.has("statusview") && <StatusViewScenario />}
        </div>
        <div hidden={tab !== "filetree"}>
          {visited.has("filetree") && <MarkdownWorkspace initialFile={file} />}
        </div>
        <div hidden={tab !== "mixedbacklog"}>
          {visited.has("mixedbacklog") && (
            <MixedBacklogScenario
              onOpenFiles={(path) => {
                setFile(path)
                setVisited((current) => new Set([...current, "filetree"]))
                setTab("filetree")
              }}
            />
          )}
        </div>
      </div>
    </section>
  )
}

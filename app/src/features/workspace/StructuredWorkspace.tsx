import { archivePage, pageDepth, restorePage } from "@block-editor/workspace"
import { useEffect, useState } from "react"
import { useWorkspacePersistence } from "./useWorkspacePersistence"
import { WorkspaceTopbar, WorkspaceTrash } from "./WorkspaceChrome"
import { WorkspaceDialogs } from "./WorkspaceDialogs"
import { WorkspaceDocument } from "./WorkspaceDocument"
import { WorkspaceTree } from "./WorkspaceTree"
import { pageReferenceTargets } from "./workspace-editor-model"
import "./workspace.css"
import "./workspace-overlays.css"

export const StructuredWorkspace = () => {
  const persistence = useWorkspacePersistence()
  const [activeId, setActiveId] = useState("home")
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [pasteMode, setPasteMode] = useState<"clone" | "reference">(() =>
    localStorage.getItem("structured-paste-mode") === "reference" ? "reference" : "clone",
  )
  const [newTitle, setNewTitle] = useState("")
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(
    () => new Set(JSON.parse(localStorage.getItem("structured-favorites") ?? "[]")),
  )

  useEffect(() => {
    const command = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault()
        document.querySelector<HTMLInputElement>(".structured-search input")?.focus()
      }
    }
    window.addEventListener("keydown", command)
    return () => window.removeEventListener("keydown", command)
  }, [])

  const payload = persistence.payload
  const active = payload?.documents.find((record) => record.content.pageId === activeId)
  const activePage = payload?.tree.content.pages.find((page) => page.id === activeId)
  const archived = payload?.tree.content.pages.filter((page) => page.archived) ?? []
  const create = async () => {
    if (newTitle.trim() === "") return
    const id = await persistence.createPage(newTitle.trim(), activeId)
    if (id === null) return
    setActiveId(id)
    setCreateOpen(false)
    setNewTitle("")
  }
  const toggleFavorite = (id: string) => {
    const next = new Set(favorites)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setFavorites(next)
    localStorage.setItem("structured-favorites", JSON.stringify([...next]))
  }

  if (payload === null || active === undefined || activePage === undefined)
    return (
      <section className="structured-loading" role="status">
        {persistence.status}
      </section>
    )
  return (
    <section className="structured-workspace" aria-label="문서와 데이터베이스">
      <WorkspaceTree
        workspace={payload.tree.content}
        activeId={activeId}
        favorites={favorites}
        query={query}
        onQuery={setQuery}
        onSelect={setActiveId}
        onCreate={() => setCreateOpen(true)}
        onFavorite={toggleFavorite}
        onArchive={(id) => persistence.updateTree(archivePage(payload.tree.content, id))}
      />
      <main className="structured-main">
        <WorkspaceTopbar title={activePage.title} status={persistence.status} />
        <WorkspaceDocument
          key={activeId}
          workspace={payload.tree.content}
          document={active.content}
          depth={pageDepth(payload.tree.content, activeId)}
          databases={payload.databases.map((record) => record.content)}
          sources={payload.sources}
          pasteMode={pasteMode}
          onPasteMode={(mode) => {
            setPasteMode(mode)
            localStorage.setItem("structured-paste-mode", mode)
          }}
          backlinks={payload.documents.flatMap((record) => {
            const page = payload.tree.content.pages.find(
              (candidate) => candidate.id === record.content.pageId,
            )
            if (page === undefined || page.id === activeId) return []
            return pageReferenceTargets(record.content.blocks)
              .filter((reference) => reference.pageId === activeId)
              .map((reference) => ({
                blockId: reference.blockId,
                pageId: page.id,
                title: page.title,
              }))
          })}
          onOpenPage={(id, blockId) => {
            setActiveId(id)
            const url = new URL(window.location.href)
            url.hash = blockId === undefined ? "" : encodeURIComponent(blockId)
            window.history.replaceState(null, "", url)
          }}
          onDocument={persistence.updateDocument}
          onDatabase={persistence.updateDatabase}
          onSourceEdit={persistence.updateSource}
          onSourceCreate={persistence.createSource}
          onSourceCompositionChange={(sourceId, composing) =>
            persistence.setComposing({ kind: "sources", id: sourceId }, composing)
          }
          onCompositionChange={(composing) =>
            persistence.setComposing({ kind: "pages", id: active.documentId }, composing)
          }
        />
        <WorkspaceTrash
          pages={archived}
          onRestore={(id) => persistence.updateTree(restorePage(payload.tree.content, id))}
        />
      </main>
      <WorkspaceDialogs
        createOpen={createOpen}
        newTitle={newTitle}
        onTitle={setNewTitle}
        onCreate={() => void create()}
        onCloseCreate={() => setCreateOpen(false)}
      />
    </section>
  )
}

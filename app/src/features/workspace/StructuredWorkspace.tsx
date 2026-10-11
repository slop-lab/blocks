import { archivePage, createPage, pageDepth, restorePage } from "@block-editor/workspace"
import { HTTPError } from "ky"
import { useCallback, useEffect, useState } from "react"
import { WorkspaceTopbar, WorkspaceTrash } from "./WorkspaceChrome"
import { WorkspaceDialogs } from "./WorkspaceDialogs"
import { WorkspaceDocument } from "./WorkspaceDocument"
import { WorkspaceTree } from "./WorkspaceTree"
import {
  createPageDocument,
  entityRecordSchemas,
  loadWorkspace,
  saveWorkspaceEntity,
  type WorkspacePayload,
} from "./workspace-api"
import "./workspace.css"
import "./workspace-overlays.css"

type SaveTarget = { readonly kind: "pages" | "databases" | "sources"; readonly id: string }

export const StructuredWorkspace = () => {
  const [payload, setPayload] = useState<WorkspacePayload | null>(null)
  const [activeId, setActiveId] = useState("home")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("작업 공간을 여는 중입니다.")
  const [dirty, setDirty] = useState<SaveTarget | null>(null)
  const [sharedEdit, setSharedEdit] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(
    () => new Set(JSON.parse(localStorage.getItem("structured-favorites") ?? "[]")),
  )

  const open = useCallback(async () => {
    try {
      const next = await loadWorkspace()
      setPayload(next)
      setStatus("서버 JSON 작업 공간을 열었습니다.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "작업 공간을 열지 못했습니다.")
    }
  }, [])
  useEffect(() => void open(), [open])
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
  useEffect(() => {
    if (dirty !== null) return
    const timer = window.setInterval(() => void open(), 2_000)
    return () => window.clearInterval(timer)
  }, [dirty, open])

  useEffect(() => {
    if (payload === null || dirty === null) return
    const timer = window.setTimeout(async () => {
      setStatus("저장 중")
      try {
        if (dirty.kind === "pages") {
          const record = payload.documents.find((item) => item.documentId === dirty.id)
          if (record === undefined) return
          const saved = await saveWorkspaceEntity(
            "pages",
            record,
            record.content,
            entityRecordSchemas.pages,
          )
          setPayload({
            ...payload,
            documents: payload.documents.map((item) =>
              item.documentId === dirty.id ? saved : item,
            ),
          })
        } else if (dirty.kind === "databases") {
          const record = payload.databases.find((item) => item.documentId === dirty.id)
          if (record === undefined) return
          const saved = await saveWorkspaceEntity(
            "databases",
            record,
            record.content,
            entityRecordSchemas.databases,
          )
          setPayload({
            ...payload,
            databases: payload.databases.map((item) =>
              item.documentId === dirty.id ? saved : item,
            ),
          })
        } else {
          const record = payload.sources.find((item) => item.documentId === dirty.id)
          if (record === undefined) return
          const saved = await saveWorkspaceEntity(
            "sources",
            record,
            record.content,
            entityRecordSchemas.sources,
          )
          setPayload({
            ...payload,
            sources: payload.sources.map((item) => (item.documentId === dirty.id ? saved : item)),
          })
        }
        setDirty(null)
        setStatus("모든 변경을 저장했습니다.")
      } catch (error) {
        if (error instanceof HTTPError && error.response.status === 409)
          setStatus("다른 창의 변경이 먼저 저장되었습니다. 새로고침해 확인하세요.")
        else setStatus(error instanceof Error ? error.message : "저장하지 못했습니다.")
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [dirty, payload])

  const active = payload?.documents.find((record) => record.content.pageId === activeId)
  const activePage = payload?.tree.content.pages.find((page) => page.id === activeId)
  const archived = payload?.tree.content.pages.filter((page) => page.archived) ?? []
  const shared = payload?.sources.find((record) => record.content.id === sharedEdit)
  const saveTree = async (content: WorkspacePayload["tree"]["content"]) => {
    if (payload === null) return
    const tree = await saveWorkspaceEntity(
      "trees",
      payload.tree,
      { ...content, version: content.version + 1 },
      entityRecordSchemas.trees,
    )
    setPayload({ ...payload, tree })
  }
  const create = async () => {
    if (payload === null || newTitle.trim() === "") return
    const id = `page-${crypto.randomUUID()}`
    await saveTree(
      createPage(payload.tree.content, {
        id,
        parentId: activeId,
        title: newTitle.trim(),
        icon: "file",
      }),
    )
    const document = await createPageDocument(id)
    setPayload((current) =>
      current === null ? current : { ...current, documents: [...current.documents, document] },
    )
    setActiveId(id)
    setCreateOpen(false)
    setNewTitle("")
    setStatus("새 페이지와 문서를 저장했습니다.")
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
        {status}
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
        onArchive={(id) => void saveTree(archivePage(payload.tree.content, id))}
      />
      <main className="structured-main">
        <WorkspaceTopbar title={activePage.title} status={status} />
        <WorkspaceDocument
          workspace={payload.tree.content}
          document={active.content}
          depth={pageDepth(payload.tree.content, activeId)}
          databases={payload.databases.map((record) => record.content)}
          sources={payload.sources.map((record) => record.content)}
          onOpenPage={setActiveId}
          onDocument={(document) => {
            setPayload({
              ...payload,
              documents: payload.documents.map((record) =>
                record.documentId === active.documentId
                  ? { ...record, content: { ...document, version: document.version + 1 } }
                  : record,
              ),
            })
            setDirty({ kind: "pages", id: active.documentId })
            setStatus("저장 대기")
          }}
          onDatabase={(database) => {
            setPayload({
              ...payload,
              databases: payload.databases.map((record) =>
                record.documentId === database.id
                  ? { ...record, content: { ...database, version: database.version + 1 } }
                  : record,
              ),
            })
            setDirty({ kind: "databases", id: database.id })
            setStatus("저장 대기")
          }}
          onSourceEdit={(source) => setSharedEdit(source.id)}
        />
        <WorkspaceTrash
          pages={archived}
          onRestore={(id) => void saveTree(restorePage(payload.tree.content, id))}
        />
      </main>
      <WorkspaceDialogs
        createOpen={createOpen}
        newTitle={newTitle}
        sharedText={shared?.content.blocks[0]?.text ?? null}
        onTitle={setNewTitle}
        onCreate={() => void create()}
        onCloseCreate={() => setCreateOpen(false)}
        onCloseShared={() => setSharedEdit(null)}
        onSharedText={(value) => {
          if (shared === undefined) return
          const first = shared.content.blocks[0]
          if (first === undefined) return
          setPayload({
            ...payload,
            sources: payload.sources.map((record) =>
              record.documentId === shared.documentId
                ? {
                    ...record,
                    content: {
                      ...record.content,
                      version: record.content.version + 1,
                      blocks: [{ ...first, text: value }, ...record.content.blocks.slice(1)],
                    },
                  }
                : record,
            ),
          })
          setDirty({ kind: "sources", id: shared.documentId })
          setStatus("저장 대기")
        }}
      />
    </section>
  )
}

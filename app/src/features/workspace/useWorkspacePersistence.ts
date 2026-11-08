import type { Database, PageDocument, SyncedSource, Workspace } from "@slop-lab/blocks-workspace"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  createWorkspacePage,
  createWorkspaceSource,
  type EntityRecord,
  loadWorkspace,
  type WorkspacePayload,
} from "./workspace-api"
import type { SourceEditRequest } from "./workspace-node-view-types"
import { createWorkspaceSaveQueue, type WorkspaceSourceEvents } from "./workspace-persistence-queue"
import {
  mergeWorkspacePayload,
  type SaveTarget,
  type WorkspaceSaveQueue,
} from "./workspace-save-queue"

export const useWorkspacePersistence = (sourceEvents: WorkspaceSourceEvents) => {
  const [payload, setPayload] = useState<WorkspacePayload | null>(null)
  const [status, setStatus] = useState("Opening the workspace.")
  const stateRef = useRef(payload)
  const commit = useCallback(
    (update: (current: WorkspacePayload | null) => WorkspacePayload | null) => {
      const next = update(stateRef.current)
      stateRef.current = next
      setPayload(next)
    },
    [],
  )
  const queueRef = useRef<WorkspaceSaveQueue | null>(null)
  if (queueRef.current === null)
    queueRef.current = createWorkspaceSaveQueue(sourceEvents, commit, setStatus)
  const queue = queueRef.current

  const open = useCallback(
    async (announce = true) => {
      try {
        const remote = await loadWorkspace()
        for (const record of remote.sources) sourceEvents.receiveRemote(record)
        commit((current) =>
          current === null
            ? remote
            : mergeWorkspacePayload(current, remote, (target) => queue.isDirty(target)),
        )
        if (announce) setStatus("Opened the server-backed JSON workspace.")
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not open the workspace.")
      }
    },
    [commit, queue, sourceEvents],
  )

  useEffect(() => {
    queue.resume()
    void open()
    const poll = window.setInterval(() => void open(false), 2_000)
    const online = () => queue.retry()
    window.addEventListener("online", online)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener("online", online)
      queue.dispose()
    }
  }, [open, queue])

  const stage = <T>(target: SaveTarget, record: EntityRecord<T>, content: T) => {
    queue.stage(target, record, content)
    setStatus("Waiting to save")
  }
  const updateDocument = (document: PageDocument) =>
    commit((current) => {
      if (current === null) return current
      const record = current.documents.find((item) => item.documentId === document.pageId)
      if (record === undefined) return current
      const content = document
      stage({ kind: "pages", id: record.documentId }, record, content)
      return {
        ...current,
        documents: current.documents.map((item) =>
          item.documentId === record.documentId ? { ...item, content } : item,
        ),
      }
    })
  const updateDatabase = (database: Database) =>
    commit((current) => {
      if (current === null) return current
      const record = current.databases.find((item) => item.documentId === database.id)
      if (record === undefined) return current
      const content = { ...database, version: database.version + 1 }
      stage({ kind: "databases", id: record.documentId }, record, content)
      return {
        ...current,
        databases: current.databases.map((item) =>
          item.documentId === record.documentId ? { ...item, content } : item,
        ),
      }
    })
  const updateSource = (request: SourceEditRequest) =>
    commit((current) => {
      if (current === null) return current
      const record = current.sources.find((item) => item.documentId === request.sourceId)
      if (record === undefined) return current
      if (record.revision !== request.baselineRevision) {
        sourceEvents.receiveRemote(record)
        setStatus("Changes from another window conflict with this draft. Choose how to recover it.")
        return current
      }
      const content = request.content
      queue.stage({ kind: "sources", id: record.documentId }, record, content, {
        generation: request.generation,
        causeId: request.causeId,
        baselineRevision: request.baselineRevision,
      })
      setStatus("Waiting to save")
      return {
        ...current,
        sources: current.sources.map((item) =>
          item.documentId === record.documentId ? { ...item, content } : item,
        ),
      }
    })
  const updateTree = (workspace: Workspace) =>
    commit((current) => {
      if (current === null) return current
      const content = { ...workspace, version: workspace.version + 1 }
      stage({ kind: "trees", id: current.tree.documentId }, current.tree, content)
      return { ...current, tree: { ...current.tree, content } }
    })

  const resolveSourceConflict = (sourceId: string, resolution: "accept-remote" | "keep-local") => {
    const result = sourceEvents.resolve(sourceId, resolution)
    if (result === null) return
    const target = { kind: "sources" as const, id: sourceId }
    if (result.kind === "accept-remote") queue.discard(target)
    else
      queue.rebase(target, result.record, {
        generation: result.generation,
        causeId: result.causeId,
        baselineRevision: result.baselineRevision,
      })
    commit((current) => {
      if (current === null) return current
      return {
        ...current,
        sources: current.sources.map((record) =>
          record.documentId !== sourceId
            ? record
            : result.kind === "accept-remote"
              ? result.record
              : { ...result.record, content: record.content },
        ),
      }
    })
    setStatus(
      result.kind === "accept-remote"
        ? "Accepted the server changes."
        : "Saving the local draft over the latest source.",
    )
  }

  const createPage = async (title: string, parentId: string) => {
    const current = stateRef.current
    if (current === null) return null
    const treeTarget = { kind: "trees" as const, id: current.tree.documentId }
    await queue.flush(treeTarget)
    const fresh = stateRef.current
    if (fresh === null) return null
    const id = `page-${crypto.randomUUID()}`
    const created = await createWorkspacePage({
      expectedTreeRevision: fresh.tree.revision,
      page: { id, parentId, title, icon: "file" },
    })
    commit((value) =>
      value === null
        ? value
        : { ...value, tree: created.tree, documents: [...value.documents, created.document] },
    )
    setStatus("Saved the new page and document.")
    return id
  }

  const createSource = async (source: SyncedSource): Promise<EntityRecord<SyncedSource> | null> => {
    try {
      const created = await createWorkspaceSource(source)
      commit((current) =>
        current === null ? current : { ...current, sources: [...current.sources, created] },
      )
      setStatus("Saved the shared source.")
      return created
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setStatus(error.message)
      return null
    }
  }

  return {
    payload,
    status,
    updateDocument,
    updateDatabase,
    updateSource,
    updateTree,
    resolveSourceConflict,
    createPage,
    createSource,
    setComposing: (target: SaveTarget, composing: boolean) => queue.setComposing(target, composing),
  }
}

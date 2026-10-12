import type { Database, PageDocument, SyncedSource, Workspace } from "@block-editor/workspace"
import { HTTPError } from "ky"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  createWorkspacePage,
  createWorkspaceSource,
  type EntityRecord,
  entityRecordSchemas,
  loadWorkspace,
  type WorkspacePayload,
} from "./workspace-api"
import { saveWorkspaceRequest } from "./workspace-persistence-request"
import {
  mergeWorkspacePayload,
  type SaveSettlement,
  type SaveTarget,
  WorkspaceSaveQueue,
} from "./workspace-save-queue"

const replace = <T>(
  records: readonly EntityRecord<T>[],
  id: string,
  saved: EntityRecord<T>,
  clean: boolean,
): readonly EntityRecord<T>[] =>
  records.map((record) =>
    record.documentId !== id ? record : clean ? saved : { ...saved, content: record.content },
  )

export const useWorkspacePersistence = () => {
  const [payload, setPayload] = useState<WorkspacePayload | null>(null)
  const [status, setStatus] = useState("작업 공간을 여는 중입니다.")
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
    queueRef.current = new WorkspaceSaveQueue(
      saveWorkspaceRequest,
      (settlement: SaveSettlement) => {
        commit((current) => {
          if (current === null) return current
          const { target, saved, clean } = settlement
          switch (target.kind) {
            case "trees":
              return {
                ...current,
                tree: clean
                  ? entityRecordSchemas.trees.parse(saved)
                  : {
                      ...entityRecordSchemas.trees.parse(saved),
                      content: current.tree.content,
                    },
              }
            case "pages":
              return {
                ...current,
                documents: replace(
                  current.documents,
                  target.id,
                  entityRecordSchemas.pages.parse(saved),
                  clean,
                ),
              }
            case "databases":
              return {
                ...current,
                databases: replace(
                  current.databases,
                  target.id,
                  entityRecordSchemas.databases.parse(saved),
                  clean,
                ),
              }
            case "sources":
              return {
                ...current,
                sources: replace(
                  current.sources,
                  target.id,
                  entityRecordSchemas.sources.parse(saved),
                  clean,
                ),
              }
            default:
              return target.kind satisfies never
          }
        })
        setStatus(settlement.clean ? "모든 변경을 저장했습니다." : "최신 변경을 이어서 저장합니다.")
      },
      (_target, error) => {
        setStatus(
          error instanceof HTTPError && error.response.status === 409
            ? "다른 창의 변경이 먼저 저장되었습니다. 초안은 유지됩니다."
            : error instanceof Error
              ? error.message
              : "저장하지 못했습니다. 초안은 유지됩니다.",
        )
      },
    )
  const queue = queueRef.current

  const open = useCallback(
    async (announce = true) => {
      try {
        const remote = await loadWorkspace()
        commit((current) =>
          current === null
            ? remote
            : mergeWorkspacePayload(current, remote, (target) => queue.isDirty(target)),
        )
        if (announce) setStatus("서버 JSON 작업 공간을 열었습니다.")
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "작업 공간을 열지 못했습니다.")
      }
    },
    [commit, queue],
  )

  useEffect(() => {
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
    setStatus("저장 대기")
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
  const updateSource = (source: SyncedSource) =>
    commit((current) => {
      if (current === null) return current
      const record = current.sources.find((item) => item.documentId === source.id)
      if (record === undefined) return current
      const content = source
      stage({ kind: "sources", id: record.documentId }, record, content)
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
    setStatus("새 페이지와 문서를 저장했습니다.")
    return id
  }

  const createSource = async (source: SyncedSource): Promise<EntityRecord<SyncedSource> | null> => {
    try {
      const created = await createWorkspaceSource(source)
      commit((current) =>
        current === null ? current : { ...current, sources: [...current.sources, created] },
      )
      setStatus("공유 원본을 저장했습니다.")
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
    createPage,
    createSource,
    setComposing: (target: SaveTarget, composing: boolean) => queue.setComposing(target, composing),
  }
}

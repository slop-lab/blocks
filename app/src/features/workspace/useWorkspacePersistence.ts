import {
  type Database,
  type PageDocument,
  type SyncedSource,
  syncedSourceSchema,
  type Workspace,
} from "@block-editor/workspace"
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
import type { SourceEditRequest } from "./workspace-node-view-types"
import { saveWorkspaceRequest } from "./workspace-persistence-request"
import {
  mergeWorkspacePayload,
  type SaveSettlement,
  type SaveTarget,
  WorkspaceSaveQueue,
} from "./workspace-save-queue"
import type { SourceConflictResult } from "./workspace-source-runtime"

type WorkspaceSourceEvents = {
  readonly acknowledge: (request: SourceEditRequest, saved: EntityRecord<SyncedSource>) => void
  readonly receiveRemote: (record: EntityRecord<SyncedSource>) => void
  readonly resolve: (
    sourceId: string,
    resolution: "accept-remote" | "keep-local",
  ) => SourceConflictResult | null
}

const replace = <T>(
  records: readonly EntityRecord<T>[],
  id: string,
  saved: EntityRecord<T>,
  clean: boolean,
): readonly EntityRecord<T>[] =>
  records.map((record) =>
    record.documentId !== id ? record : clean ? saved : { ...saved, content: record.content },
  )

export const useWorkspacePersistence = (sourceEvents: WorkspaceSourceEvents) => {
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
            case "sources": {
              const savedSource = entityRecordSchemas.sources.parse(saved)
              if (settlement.causality !== undefined)
                sourceEvents.acknowledge(
                  {
                    sourceId: target.id,
                    ...settlement.causality,
                    content: syncedSourceSchema.parse(settlement.content),
                  },
                  savedSource,
                )
              return {
                ...current,
                sources: replace(current.sources, target.id, savedSource, clean),
              }
            }
            default:
              return target.kind satisfies never
          }
        })
        setStatus(settlement.clean ? "모든 변경을 저장했습니다." : "최신 변경을 이어서 저장합니다.")
      },
      (request, error) => {
        setStatus(
          error instanceof HTTPError && error.response.status === 409
            ? "다른 창의 변경이 먼저 저장되었습니다. 초안은 유지됩니다."
            : error instanceof Error
              ? error.message
              : "저장하지 못했습니다. 초안은 유지됩니다.",
        )
        if (
          request.target.kind === "sources" &&
          error instanceof HTTPError &&
          error.response.status === 409
        ) {
          void loadWorkspace().then((remote) => {
            for (const record of remote.sources) sourceEvents.receiveRemote(record)
          })
          return "pause"
        }
        return error instanceof HTTPError && error.response.status === 409 ? "pause" : undefined
      },
    )
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
        if (announce) setStatus("서버 JSON 작업 공간을 열었습니다.")
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "작업 공간을 열지 못했습니다.")
      }
    },
    [commit, queue, sourceEvents],
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
  const updateSource = (request: SourceEditRequest) =>
    commit((current) => {
      if (current === null) return current
      const record = current.sources.find((item) => item.documentId === request.sourceId)
      if (record === undefined) return current
      if (record.revision !== request.baselineRevision) {
        sourceEvents.receiveRemote(record)
        setStatus("다른 창의 변경과 충돌했습니다. 초안 복구 방식을 선택하세요.")
        return current
      }
      const content = request.content
      queue.stage({ kind: "sources", id: record.documentId }, record, content, {
        generation: request.generation,
        causeId: request.causeId,
        baselineRevision: request.baselineRevision,
      })
      setStatus("저장 대기")
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
        ? "서버 변경을 수락했습니다."
        : "로컬 초안을 최신 원본 위에 다시 저장합니다.",
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
    resolveSourceConflict,
    createPage,
    createSource,
    setComposing: (target: SaveTarget, composing: boolean) => queue.setComposing(target, composing),
  }
}

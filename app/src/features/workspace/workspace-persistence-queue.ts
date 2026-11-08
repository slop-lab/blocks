import { type SyncedSource, syncedSourceSchema } from "@slop-lab/blocks-workspace"
import { HTTPError } from "ky"
import {
  type EntityRecord,
  entityRecordSchemas,
  loadWorkspace,
  type WorkspacePayload,
} from "./workspace-api"
import type { SourceEditRequest } from "./workspace-node-view-types"
import { saveWorkspaceRequest } from "./workspace-persistence-request"
import { type SaveSettlement, WorkspaceSaveQueue } from "./workspace-save-queue"
import type { SourceConflictResult } from "./workspace-source-runtime"

export type WorkspaceSourceEvents = {
  readonly registerSubmitted: (request: SourceEditRequest) => void
  readonly acknowledge: (request: SourceEditRequest, saved: EntityRecord<SyncedSource>) => void
  readonly receiveRemote: (record: EntityRecord<SyncedSource>) => void
  readonly resolve: (
    sourceId: string,
    resolution: "accept-remote" | "keep-local",
  ) => SourceConflictResult | null
}

type Commit = (update: (current: WorkspacePayload | null) => WorkspacePayload | null) => void
type SetStatus = (status: string) => void

const replace = <T>(
  records: readonly EntityRecord<T>[],
  id: string,
  saved: EntityRecord<T>,
  clean: boolean,
): readonly EntityRecord<T>[] =>
  records.map((record) =>
    record.documentId !== id ? record : clean ? saved : { ...saved, content: record.content },
  )

export const createWorkspaceSaveQueue = (
  sourceEvents: WorkspaceSourceEvents,
  commit: Commit,
  setStatus: SetStatus,
): WorkspaceSaveQueue =>
  new WorkspaceSaveQueue(
    (request) => {
      if (request.target.kind === "sources" && request.causality !== undefined)
        sourceEvents.registerSubmitted({
          sourceId: request.target.id,
          ...request.causality,
          content: syncedSourceSchema.parse(request.content),
        })
      return saveWorkspaceRequest(request)
    },
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
      setStatus(settlement.clean ? "Saved all changes." : "Continuing to save the latest changes.")
    },
    (request, error) => {
      const conflict = error instanceof HTTPError && error.response.status === 409
      setStatus(
        conflict
          ? "Changes from another window were saved first. Your draft is preserved."
          : error instanceof Error
            ? error.message
            : "Could not save. Your draft is preserved.",
      )
      if (request.target.kind !== "sources" || !conflict) return conflict ? "pause" : undefined
      void loadWorkspace()
        .then((remote) => {
          for (const record of remote.sources) sourceEvents.receiveRemote(record)
        })
        .catch((refreshError: unknown) => {
          setStatus(
            refreshError instanceof Error
              ? refreshError.message
              : "Could not reload the conflicting source.",
          )
        })
      return "pause"
    },
  )

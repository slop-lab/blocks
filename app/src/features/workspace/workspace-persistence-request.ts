import {
  databaseSchema,
  pageDocumentSchema,
  syncedSourceSchema,
  workspaceSchema,
} from "@block-editor/workspace"
import { entityRecordSchemas, saveWorkspaceEntity } from "./workspace-api"
import type { QueueRecord, SaveRequest } from "./workspace-save-queue"

export const saveWorkspaceRequest = async ({
  target,
  baseline,
  content,
}: SaveRequest): Promise<QueueRecord> => {
  switch (target.kind) {
    case "trees":
      return saveWorkspaceEntity(
        "trees",
        entityRecordSchemas.trees.parse(baseline),
        workspaceSchema.parse(content),
        entityRecordSchemas.trees,
      )
    case "pages":
      return saveWorkspaceEntity(
        "pages",
        entityRecordSchemas.pages.parse(baseline),
        pageDocumentSchema.parse(content),
        entityRecordSchemas.pages,
      )
    case "databases":
      return saveWorkspaceEntity(
        "databases",
        entityRecordSchemas.databases.parse(baseline),
        databaseSchema.parse(content),
        entityRecordSchemas.databases,
      )
    case "sources":
      return saveWorkspaceEntity(
        "sources",
        entityRecordSchemas.sources.parse(baseline),
        syncedSourceSchema.parse(content),
        entityRecordSchemas.sources,
      )
    default:
      return target.kind satisfies never
  }
}

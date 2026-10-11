import {
  type Database,
  databaseSchema,
  type PageDocument,
  pageDocumentSchema,
  type SyncedSource,
  syncedSourceSchema,
  type Workspace,
  workspaceSchema,
} from "@block-editor/workspace"
import ky from "ky"
import { z } from "zod"

const record = <T extends z.ZodType>(content: T) =>
  z
    .object({
      documentId: z.string(),
      revision: z.number().int().positive(),
      content,
      metadata: z.record(z.string(), z.unknown()),
      history: z.array(z.unknown()),
    })
    .strict()
const treeRecordSchema = record(workspaceSchema)
const pageRecordSchema = record(pageDocumentSchema)
const databaseRecordSchema = record(databaseSchema)
const sourceRecordSchema = record(syncedSourceSchema)
const payloadSchema = z
  .object({
    tree: treeRecordSchema,
    documents: z.array(pageRecordSchema),
    databases: z.array(databaseRecordSchema),
    sources: z.array(sourceRecordSchema),
  })
  .strict()

export type EntityRecord<T> = {
  readonly documentId: string
  readonly revision: number
  readonly content: T
  readonly metadata: Readonly<Record<string, unknown>>
  readonly history: readonly unknown[]
}
export type WorkspacePayload = {
  readonly tree: EntityRecord<Workspace>
  readonly documents: readonly EntityRecord<PageDocument>[]
  readonly databases: readonly EntityRecord<Database>[]
  readonly sources: readonly EntityRecord<SyncedSource>[]
}

const client = ky.create({ timeout: 10_000, retry: 0 })
export const loadWorkspace = async (): Promise<WorkspacePayload> =>
  payloadSchema.parse(await client.get("api/workspace").json())

type EntityKind = "trees" | "pages" | "databases" | "sources"
export const saveWorkspaceEntity = async <T>(
  kind: EntityKind,
  recordValue: EntityRecord<T>,
  content: T,
  schema: z.ZodType<EntityRecord<T>>,
): Promise<EntityRecord<T>> => {
  const response = await client
    .put(`api/workspace/${kind}/${recordValue.documentId}`, {
      json: { expectedRevision: recordValue.revision, content },
    })
    .json()
  return schema.parse(response)
}

export const entityRecordSchemas = {
  trees: treeRecordSchema,
  pages: pageRecordSchema,
  databases: databaseRecordSchema,
  sources: sourceRecordSchema,
} as const

export const createPageDocument = async (pageId: string): Promise<EntityRecord<PageDocument>> =>
  pageRecordSchema.parse(
    await client
      .put(`api/workspace/pages/${pageId}`, {
        json: {
          content: {
            pageId,
            version: 1,
            blocks: [
              { id: `${pageId}-heading`, type: "heading", level: 1, text: "제목 없음" },
              { id: `${pageId}-paragraph`, type: "paragraph", text: "내용을 작성하세요." },
            ],
          },
        },
      })
      .json(),
  )

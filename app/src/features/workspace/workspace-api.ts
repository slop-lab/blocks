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

const createdPageSchema = z.object({ tree: treeRecordSchema, document: pageRecordSchema }).strict()

export const createWorkspacePage = async (input: {
  readonly expectedTreeRevision: number
  readonly page: {
    readonly id: string
    readonly parentId: string | null
    readonly title: string
    readonly icon: "file" | "database" | "note"
  }
}): Promise<{
  readonly tree: EntityRecord<Workspace>
  readonly document: EntityRecord<PageDocument>
}> => createdPageSchema.parse(await client.post("api/workspace/pages", { json: input }).json())

export const createWorkspaceSource = async (
  source: SyncedSource,
): Promise<EntityRecord<SyncedSource>> =>
  sourceRecordSchema.parse(
    await client.put(`api/workspace/sources/${source.id}`, { json: { content: source } }).json(),
  )

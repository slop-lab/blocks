import { z } from "zod"

export const entityIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/u)
export const pageSchema = z
  .object({
    id: entityIdSchema,
    parentId: entityIdSchema.nullable(),
    title: z.string().trim().min(1).max(160),
    icon: z.enum(["file", "database", "note"]),
    archived: z.boolean(),
  })
  .strict()
export const workspaceSchema = z
  .object({
    id: entityIdSchema,
    version: z.number().int().positive(),
    pages: z.array(pageSchema).max(500),
  })
  .strict()

export const textBlockSchema = z
  .object({ id: entityIdSchema, type: z.literal("paragraph"), text: z.string().max(20_000) })
  .strict()
export const headingBlockSchema = z
  .object({
    id: entityIdSchema,
    type: z.literal("heading"),
    level: z.number().int().min(1).max(6),
    text: z.string().max(2_000),
  })
  .strict()
export const quoteBlockSchema = z
  .object({ id: entityIdSchema, type: z.literal("quote"), text: z.string().max(20_000) })
  .strict()
export const codeBlockSchema = z
  .object({ id: entityIdSchema, type: z.literal("code"), text: z.string().max(50_000) })
  .strict()
export const pageReferenceBlockSchema = z
  .object({ id: entityIdSchema, type: z.literal("page_ref"), pageId: entityIdSchema })
  .strict()
export const syncedReferenceBlockSchema = z
  .object({
    id: entityIdSchema,
    type: z.literal("synced_ref"),
    occurrenceId: entityIdSchema,
    sourceId: entityIdSchema,
  })
  .strict()
export const databaseEmbedBlockSchema = z
  .object({
    id: entityIdSchema,
    type: z.literal("database_embed"),
    databaseId: entityIdSchema,
    layout: z.enum(["table", "kanban"]),
  })
  .strict()
export const blockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  headingBlockSchema,
  quoteBlockSchema,
  codeBlockSchema,
  pageReferenceBlockSchema,
  syncedReferenceBlockSchema,
  databaseEmbedBlockSchema,
])
export const pageDocumentSchema = z
  .object({
    pageId: entityIdSchema,
    version: z.number().int().positive(),
    blocks: z.array(blockSchema).max(2_000),
  })
  .strict()

const basePropertySchema = z.object({
  id: entityIdSchema,
  name: z.string().trim().min(1).max(80),
})
export const propertySchema = z.discriminatedUnion("type", [
  basePropertySchema.extend({ type: z.literal("text") }).strict(),
  basePropertySchema.extend({ type: z.literal("number") }).strict(),
  basePropertySchema.extend({ type: z.literal("checkbox") }).strict(),
  basePropertySchema.extend({ type: z.literal("date") }).strict(),
  basePropertySchema
    .extend({ type: z.literal("select"), options: z.array(z.string().min(1).max(40)).max(40) })
    .strict(),
  basePropertySchema
    .extend({ type: z.literal("status"), options: z.array(z.string().min(1).max(40)).max(40) })
    .strict(),
  basePropertySchema.extend({ type: z.literal("relation") }).strict(),
])
export const databaseRowSchema = z
  .object({
    id: entityIdSchema,
    pageId: entityIdSchema.optional(),
    values: z.record(z.string(), z.unknown()),
  })
  .strict()
export const databaseSchema = z
  .object({
    id: entityIdSchema,
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    properties: z.array(propertySchema).min(1).max(50),
    rows: z.array(databaseRowSchema).max(1_000),
  })
  .strict()

export const syncedSourceSchema = z
  .object({
    id: entityIdSchema,
    version: z.number().int().positive(),
    blocks: z.array(
      z.union([textBlockSchema, headingBlockSchema, quoteBlockSchema, codeBlockSchema]),
    ),
  })
  .strict()

export type Workspace = z.infer<typeof workspaceSchema>
export type Page = z.infer<typeof pageSchema>
export type PageDocument = z.infer<typeof pageDocumentSchema>
export type Database = z.infer<typeof databaseSchema>
export type DatabaseRow = z.infer<typeof databaseRowSchema>
export type DatabaseProperty = z.infer<typeof propertySchema>
export type SyncedSource = z.infer<typeof syncedSourceSchema>

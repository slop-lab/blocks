import { z } from "zod"
import {
  blockSchema,
  legacyBlockSchema,
  migrateLegacyBlocks,
  pageDocumentSchema,
} from "./blocks.js"
import { entityIdSchema } from "./ids.js"

export { entityIdSchema }

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

const basePropertySchema = z.object({ id: entityIdSchema, name: z.string().trim().min(1).max(80) })
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

const currentSourceSchema = z
  .object({ id: entityIdSchema, version: z.number().int().positive(), section: blockSchema })
  .strict()
  .refine((value) => value.section.type === "section", {
    path: ["section"],
    message: "Source root must be a section",
  })
const legacySourceSchema = z
  .object({
    id: entityIdSchema,
    version: z.number().int().positive(),
    blocks: z.array(legacyBlockSchema),
  })
  .strict()
export const syncedSourceSchema = z.preprocess((input) => {
  const legacy = legacySourceSchema.safeParse(input)
  return legacy.success
    ? {
        id: legacy.data.id,
        version: legacy.data.version,
        section: {
          id: `${legacy.data.id}-root`,
          type: "section",
          children: migrateLegacyBlocks(legacy.data.blocks),
        },
      }
    : input
}, currentSourceSchema)

export type Workspace = z.infer<typeof workspaceSchema>
export type Page = z.infer<typeof pageSchema>
export type PageDocument = z.infer<typeof pageDocumentSchema>
export type Database = z.infer<typeof databaseSchema>
export type DatabaseRow = z.infer<typeof databaseRowSchema>
export type DatabaseProperty = z.infer<typeof propertySchema>
export type SyncedSource = z.infer<typeof syncedSourceSchema>

export type { InlineContent, SectionBlock, WorkspaceBlock } from "./blocks.js"
export { blockSchema, pageDocumentSchema }

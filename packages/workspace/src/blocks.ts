import { z } from "zod"
import { entityIdSchema } from "./ids.js"

const simpleMarkSchema = z.object({ type: z.enum(["strong", "em", "code"]) }).strict()
const linkMarkSchema = z
  .object({
    type: z.literal("link"),
    attrs: z.object({ href: z.string().max(4_096) }).strict(),
  })
  .strict()
export const inlineMarkSchema = z.union([simpleMarkSchema, linkMarkSchema])
export const inlineContentSchema = z.array(
  z
    .object({
      kind: z.literal("text"),
      text: z.string(),
      marks: z.array(inlineMarkSchema),
    })
    .strict(),
)

export type InlineContent = z.infer<typeof inlineContentSchema>
export type ParagraphBlock = {
  readonly id: string
  readonly type: "paragraph"
  readonly text: string
  readonly content?: InlineContent | undefined
}
export type CodeBlock = { readonly id: string; readonly type: "code"; readonly text: string }
export type PageReferenceBlock = {
  readonly id: string
  readonly type: "page_ref"
  readonly pageId: string
}
export type DatabaseEmbedBlock = {
  readonly id: string
  readonly type: "database_embed"
  readonly databaseId: string
  readonly layout: "table" | "kanban"
}
export type SectionBlock = {
  readonly id: string
  readonly type: "section"
  readonly heading?: string | undefined
  readonly headingContent?: InlineContent | undefined
  readonly ref?: { readonly sourceId: string } | undefined
  readonly occurrenceId?: string | undefined
  readonly children: readonly WorkspaceBlock[]
}
export type ContainerBlock = {
  readonly id: string
  readonly type: "callout" | "quote"
  readonly children: readonly WorkspaceBlock[]
}
export type WorkspaceBlock =
  | ParagraphBlock
  | CodeBlock
  | PageReferenceBlock
  | DatabaseEmbedBlock
  | SectionBlock
  | ContainerBlock

const paragraphBlockSchema = z
  .object({
    id: entityIdSchema,
    type: z.literal("paragraph"),
    text: z.string().max(20_000),
    content: inlineContentSchema.max(2_000).optional(),
  })
  .strict()
const codeBlockSchema = z
  .object({ id: entityIdSchema, type: z.literal("code"), text: z.string().max(50_000) })
  .strict()
const pageReferenceBlockSchema = z
  .object({ id: entityIdSchema, type: z.literal("page_ref"), pageId: entityIdSchema })
  .strict()
const databaseEmbedBlockSchema = z
  .object({
    id: entityIdSchema,
    type: z.literal("database_embed"),
    databaseId: entityIdSchema,
    layout: z.enum(["table", "kanban"]),
  })
  .strict()

export const blockSchema: z.ZodType<WorkspaceBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    paragraphBlockSchema,
    codeBlockSchema,
    pageReferenceBlockSchema,
    databaseEmbedBlockSchema,
    z
      .object({
        id: entityIdSchema,
        type: z.literal("section"),
        heading: z.string().max(2_000).optional(),
        headingContent: inlineContentSchema.max(2_000).optional(),
        ref: z.object({ sourceId: entityIdSchema }).strict().optional(),
        occurrenceId: entityIdSchema.optional(),
        children: z.array(blockSchema).max(2_000),
      })
      .strict(),
    z
      .object({
        id: entityIdSchema,
        type: z.enum(["callout", "quote"]),
        children: z.array(blockSchema).max(2_000),
      })
      .strict(),
  ]),
)

const legacyHeadingSchema = z
  .object({
    id: entityIdSchema,
    type: z.literal("heading"),
    level: z.number().int().min(1).max(6),
    text: z.string().max(2_000),
  })
  .strict()
const legacyQuoteSchema = z
  .object({ id: entityIdSchema, type: z.literal("quote"), text: z.string().max(20_000) })
  .strict()
const legacySyncedSchema = z
  .object({
    id: entityIdSchema,
    type: z.literal("synced_ref"),
    occurrenceId: entityIdSchema,
    sourceId: entityIdSchema,
  })
  .strict()
export const legacyBlockSchema = z.discriminatedUnion("type", [
  paragraphBlockSchema,
  legacyHeadingSchema,
  legacyQuoteSchema,
  codeBlockSchema,
  pageReferenceBlockSchema,
  legacySyncedSchema,
  databaseEmbedBlockSchema,
])
type LegacyBlock = z.infer<typeof legacyBlockSchema>
type SectionBuilder = {
  readonly id: string
  readonly type: "section"
  readonly level: number
  readonly heading: string
  readonly headingContent?: InlineContent | undefined
  readonly ref?: { readonly sourceId: string } | undefined
  readonly occurrenceId?: string | undefined
  readonly children: WorkspaceBlock[]
}

const migrateLegacyLeaf = (
  block: Exclude<LegacyBlock, { readonly type: "heading" }>,
): WorkspaceBlock => {
  switch (block.type) {
    case "paragraph":
    case "code":
    case "page_ref":
    case "database_embed":
      return block
    case "quote":
      return {
        id: block.id,
        type: "quote",
        children: [{ id: `${block.id}-content`, type: "paragraph", text: block.text }],
      }
    case "synced_ref":
      return {
        id: block.id,
        type: "section",
        occurrenceId: block.occurrenceId,
        ref: { sourceId: block.sourceId },
        children: [],
      }
    default:
      return block satisfies never
  }
}

export const migrateLegacyBlocks = (blocks: readonly LegacyBlock[]): readonly WorkspaceBlock[] => {
  const roots: WorkspaceBlock[] = []
  const stack: SectionBuilder[] = []
  for (const block of blocks) {
    if (block.type === "heading") {
      while ((stack.at(-1)?.level ?? 0) >= block.level) stack.pop()
      const section: SectionBuilder = {
        id: block.id,
        type: "section",
        level: block.level,
        heading: block.text,
        children: [],
      }
      const parent = stack.at(-1)
      if (parent === undefined) roots.push(section)
      else parent.children.push(section)
      stack.push(section)
      continue
    }
    const parent = stack.at(-1)
    const migrated = migrateLegacyLeaf(block)
    if (parent === undefined) roots.push(migrated)
    else parent.children.push(migrated)
  }
  const stripLevel = (block: WorkspaceBlock | SectionBuilder): WorkspaceBlock => {
    if (block.type !== "section") return block
    return {
      id: block.id,
      type: "section",
      ...(block.heading === undefined ? {} : { heading: block.heading }),
      ...(block.headingContent === undefined ? {} : { headingContent: block.headingContent }),
      ...(block.ref === undefined ? {} : { ref: block.ref }),
      ...(block.occurrenceId === undefined ? {} : { occurrenceId: block.occurrenceId }),
      children: block.children.map(stripLevel),
    }
  }
  return roots.map(stripLevel)
}

const legacyPageSchema = z
  .object({
    pageId: entityIdSchema,
    version: z.number().int().positive(),
    blocks: z.array(legacyBlockSchema).max(2_000),
  })
  .strict()
const currentPageSchema = z
  .object({
    pageId: entityIdSchema,
    version: z.number().int().positive(),
    blocks: z.array(blockSchema).max(2_000),
  })
  .strict()

export const pageDocumentSchema = z.preprocess((input) => {
  const legacy = legacyPageSchema.safeParse(input)
  return legacy.success
    ? { ...legacy.data, blocks: migrateLegacyBlocks(legacy.data.blocks) }
    : input
}, currentPageSchema)

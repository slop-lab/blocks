import { z } from "zod"
import type { KnownWorkspaceBlock, WorkspaceBlock } from "./blocks.js"
import { entityIdSchema } from "./ids.js"
import { markOpaqueWorkspaceBlock } from "./opaque.js"

const knownTypes = new Set([
  "paragraph",
  "code",
  "page_ref",
  "database_embed",
  "section",
  "callout",
  "quote",
])
const knownMarks = new Set(["strong", "em", "code", "link"])
const blockKeys: Readonly<Record<string, ReadonlySet<string>>> = {
  paragraph: new Set(["id", "type", "text", "content"]),
  code: new Set(["id", "type", "text"]),
  page_ref: new Set(["id", "type", "pageId"]),
  database_embed: new Set(["id", "type", "databaseId", "layout"]),
  section: new Set(["id", "type", "heading", "headingContent", "ref", "occurrenceId", "children"]),
  callout: new Set(["id", "type", "children"]),
  quote: new Set(["id", "type", "children"]),
}
const requiredSchemas: Readonly<Record<string, z.ZodType>> = {
  paragraph: z.looseObject({
    id: entityIdSchema,
    type: z.literal("paragraph"),
    text: z.string().max(20_000),
    content: z.array(z.unknown()).max(2_000).optional(),
  }),
  code: z.looseObject({
    id: entityIdSchema,
    type: z.literal("code"),
    text: z.string().max(50_000),
  }),
  page_ref: z.looseObject({
    id: entityIdSchema,
    type: z.literal("page_ref"),
    pageId: entityIdSchema,
  }),
  database_embed: z.looseObject({
    id: entityIdSchema,
    type: z.literal("database_embed"),
    databaseId: entityIdSchema,
    layout: z.enum(["table", "kanban"]),
  }),
  section: z.looseObject({
    id: entityIdSchema,
    type: z.literal("section"),
    heading: z.string().max(2_000).optional(),
    headingContent: z.array(z.unknown()).max(2_000).optional(),
    ref: z.object({ sourceId: entityIdSchema }).strict().optional(),
    occurrenceId: entityIdSchema.optional(),
    children: z.array(z.unknown()).max(2_000),
  }),
  callout: z.looseObject({
    id: entityIdSchema,
    type: z.literal("callout"),
    children: z.array(z.unknown()).max(2_000),
  }),
  quote: z.looseObject({
    id: entityIdSchema,
    type: z.literal("quote"),
    children: z.array(z.unknown()).max(2_000),
  }),
}

type ExtensionState = "valid" | "unsupported" | "invalid"

const inlineState = (value: unknown, markSchema: z.ZodType): ExtensionState => {
  if (value === undefined) return "valid"
  if (!Array.isArray(value) || value.length > 2_000) return "invalid"
  let state: ExtensionState = "valid"
  for (const inline of value) {
    if (typeof inline !== "object" || inline === null) return "invalid"
    if (
      !("kind" in inline) ||
      inline.kind !== "text" ||
      !("text" in inline) ||
      typeof inline.text !== "string"
    )
      return "invalid"
    if (!("marks" in inline) || !Array.isArray(inline.marks)) return "invalid"
    if (Object.keys(inline).some((key) => !["kind", "text", "marks"].includes(key)))
      state = "unsupported"
    for (const mark of inline.marks) {
      if (
        typeof mark !== "object" ||
        mark === null ||
        !("type" in mark) ||
        typeof mark.type !== "string"
      )
        return "invalid"
      if (!knownMarks.has(mark.type)) {
        state = "unsupported"
        continue
      }
      const parsed = markSchema.safeParse(mark)
      if (parsed.success) continue
      if (parsed.error.issues.every((issue) => issue.code === "unrecognized_keys"))
        state = "unsupported"
      else return "invalid"
    }
  }
  return state
}

export const createWorkspaceBlockSchema = (
  knownSchema: z.ZodType<KnownWorkspaceBlock>,
  markSchema: z.ZodType,
): z.ZodType<WorkspaceBlock> =>
  z.unknown().transform((input, context) => {
    const base = z
      .looseObject({ id: entityIdSchema, type: z.string().min(1).max(160) })
      .safeParse(input)
    if (!base.success) {
      context.addIssue({ code: "custom", message: "Invalid workspace block identity" })
      return z.NEVER
    }
    if (!knownTypes.has(base.data.type)) return markOpaqueWorkspaceBlock(base.data)
    const strict = knownSchema.safeParse(input)
    if (strict.success) return strict.data
    const allowed = blockKeys[base.data.type]
    const topExtension =
      allowed !== undefined && Object.keys(base.data).some((key) => !allowed.has(key))
    const inline =
      base.data.type === "paragraph"
        ? inlineState(base.data["content"], markSchema)
        : base.data.type === "section"
          ? inlineState(base.data["headingContent"], markSchema)
          : "valid"
    if (inline !== "invalid" && (topExtension || inline === "unsupported")) {
      const required = requiredSchemas[base.data.type]?.safeParse(input)
      if (required?.success === true) return markOpaqueWorkspaceBlock(base.data)
    }
    context.addIssue({ code: "custom", message: "Invalid known workspace block" })
    return z.NEVER
  })

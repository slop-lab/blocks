import { z } from "zod"
import type { BlockDocument } from "./types.js"

const textInlineSchema = z.looseObject({
  kind: z.literal("text"),
  text: z.string().max(200_000),
  marks: z.array(z.unknown()).max(1_000),
})

const opaqueInlineSchema = z.looseObject({ kind: z.literal("opaque"), raw: z.unknown() })

const blockSchema: z.ZodType<BlockDocument["blocks"][number]> = z.lazy(() =>
  z.looseObject({
    id: z.string().min(1).max(160),
    type: z.string().min(1).max(160),
    attrs: z.record(z.string(), z.unknown()),
    content: z.array(z.union([textInlineSchema, opaqueInlineSchema])).max(20_000),
    children: z.array(blockSchema).max(10_000).optional(),
    locked: z.boolean().optional(),
  }),
)

const documentSchema = z.looseObject({
  format: z.literal("block-editor/v0.3"),
  blocks: z.array(blockSchema).max(10_000),
})

export class DocumentCodecError extends Error {
  readonly name = "DocumentCodecError"
}

export const decodeDocument = (input: unknown): BlockDocument => {
  const parsed = documentSchema.safeParse(input)
  if (!parsed.success)
    throw new DocumentCodecError(`Invalid block document: ${z.prettifyError(parsed.error)}`)
  const ids = new Set<string>()
  const visit = (blocks: BlockDocument["blocks"]): void => {
    for (const block of blocks) {
      if (ids.has(block.id)) throw new DocumentCodecError(`Duplicate block id: ${block.id}`)
      ids.add(block.id)
      visit(block.children ?? [])
    }
  }
  visit(parsed.data.blocks)
  return {
    ...parsed.data,
    blocks: parsed.data.blocks.map(({ locked, ...block }) => ({
      ...block,
      ...(locked === undefined ? {} : { locked }),
    })),
  }
}

export const encodeDocument = (document: BlockDocument): string => JSON.stringify(document)

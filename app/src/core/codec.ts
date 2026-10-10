import { z } from "zod"
import type { BlockDocument } from "./types"

const textInlineSchema = z.looseObject({
  kind: z.literal("text"),
  text: z.string().max(200_000),
  marks: z.array(z.unknown()).max(1_000),
})

const opaqueInlineSchema = z.looseObject({ kind: z.literal("opaque"), raw: z.unknown() })

const blockSchema = z.looseObject({
  id: z.string().min(1).max(160),
  type: z.string().min(1).max(160),
  attrs: z.record(z.string(), z.unknown()),
  content: z.array(z.union([textInlineSchema, opaqueInlineSchema])).max(20_000),
  locked: z.boolean().optional(),
})

const documentSchema = z.looseObject({
  format: z.literal("block-editor/v0.3"),
  blocks: z.array(blockSchema).max(10_000),
})

export class DocumentCodecError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "DocumentCodecError"
  }
}

export const decodeDocument = (input: unknown): BlockDocument => {
  const parsed = documentSchema.safeParse(input)
  if (!parsed.success) {
    throw new DocumentCodecError(`Invalid block document: ${z.prettifyError(parsed.error)}`)
  }
  const ids = new Set<string>()
  for (const block of parsed.data.blocks) {
    if (ids.has(block.id)) throw new DocumentCodecError(`Duplicate block id: ${block.id}`)
    ids.add(block.id)
  }
  return {
    ...parsed.data,
    blocks: parsed.data.blocks.map(({ locked, ...block }) => ({
      ...block,
      ...(locked === undefined ? {} : { locked }),
    })),
  }
}

export const encodeDocument = (document: BlockDocument): string => JSON.stringify(document)

export const parseDocumentText = (text: string): BlockDocument => {
  if (new Blob([text]).size > 2_000_000) throw new DocumentCodecError("Document exceeds 2 MB")
  try {
    return decodeDocument(JSON.parse(text))
  } catch (error) {
    if (error instanceof DocumentCodecError || error instanceof SyntaxError) {
      throw new DocumentCodecError(error.message)
    }
    throw error
  }
}

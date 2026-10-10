import { z } from "zod"

export const largeContentBlockSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  text: z.string(),
})

export const largeContentPageSchema = z.object({
  blocks: z.array(largeContentBlockSchema),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  continuation: z.number().int().nonnegative().nullable(),
})

export const searchResultSchema = z.object({ results: z.array(largeContentBlockSchema) })
export const patchResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("updated"), block: largeContentBlockSchema }),
  z.object({ kind: z.literal("conflict"), current: largeContentBlockSchema, draft: z.string() }),
  z.object({ kind: z.literal("missing") }),
])

export type LargeContentBlock = z.infer<typeof largeContentBlockSchema>
export type LargeContentPage = z.infer<typeof largeContentPageSchema>
export type PatchResult = z.infer<typeof patchResultSchema>
export type PartialBlockRead = Readonly<{
  loaded: readonly LargeContentBlock[]
  missing: readonly number[]
  continuation: number | null
}>

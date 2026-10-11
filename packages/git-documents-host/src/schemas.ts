import { z } from "zod"

export const pathSchema = z.string().min(1).max(240)
export const fileWriteSchema = z.object({
  path: pathSchema,
  content: z.string().max(5 * 1024 * 1024),
  expectedRevision: z.string().length(64),
})
export const createSchema = z.object({
  path: pathSchema,
  content: z
    .string()
    .max(5 * 1024 * 1024)
    .default(""),
})
export const draftSchema = z.object({
  path: pathSchema,
  content: z.string().max(5 * 1024 * 1024),
  baseRevision: z.string().length(64),
})
export const renameSchema = z.object({
  from: pathSchema,
  to: pathSchema,
  expectedRevision: z.string().length(64),
})
export const deleteSchema = z.object({ path: pathSchema, expectedRevision: z.string().length(64) })
export const commitSchema = z.object({
  paths: z.array(pathSchema).min(1).max(200),
  message: z.string().trim().min(1).max(500),
  expectedRevisions: z.record(pathSchema, z.string().length(64).nullable()),
})
export const restoreSchema = z.object({
  path: pathSchema,
  commit: z.string().regex(/^[0-9a-f]{7,64}$/u),
})
export const branchSchema = z.object({ branch: z.string().min(1).max(120) })
export const mergeSchema = z.object({ message: z.string().trim().min(1).max(500) })

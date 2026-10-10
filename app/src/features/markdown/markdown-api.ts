import ky from "ky"
import { z } from "zod"

const mappingSchema = z.object({
  id: z.string(),
  type: z.enum(["heading", "paragraph", "code", "raw"]),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
})

const fileSchema = z.object({
  name: z.string(),
  content: z.string(),
  revision: z.string(),
  mappings: z.array(mappingSchema),
})

const listSchema = z.object({ files: z.array(z.string()) })
const previewSchema = z.object({ mappings: z.array(mappingSchema) })
const conflictSchema = fileSchema.extend({
  error: z.literal("stale_revision"),
  message: z.string(),
})

export type MarkdownMapping = z.infer<typeof mappingSchema>
export type MarkdownFile = z.infer<typeof fileSchema>
export type SaveResult =
  | { readonly kind: "saved"; readonly file: MarkdownFile }
  | { readonly kind: "conflict"; readonly disk: MarkdownFile }

export const listMarkdown = async (): Promise<readonly string[]> => {
  const payload: unknown = await ky.get("/api/markdown", { timeout: 10_000 }).json()
  return listSchema.parse(payload).files
}

export const loadMarkdown = async (name: string): Promise<MarkdownFile> => {
  const payload: unknown = await ky
    .get("/api/markdown/file", { searchParams: { name }, timeout: 10_000 })
    .json()
  return fileSchema.parse(payload)
}

export const previewMarkdown = async (
  name: string,
  content: string,
): Promise<readonly MarkdownMapping[]> => {
  const payload: unknown = await ky
    .post("/api/markdown/map", { json: { name, content }, timeout: 10_000 })
    .json()
  return previewSchema.parse(payload).mappings
}

export const saveMarkdown = async (file: MarkdownFile): Promise<SaveResult> => {
  const response = await ky.put("/api/markdown/file", {
    json: { name: file.name, content: file.content, expectedRevision: file.revision },
    timeout: 10_000,
    throwHttpErrors: false,
  })
  const payload: unknown = await response.json()
  if (response.status === 409) return { kind: "conflict", disk: conflictSchema.parse(payload) }
  if (!response.ok) throw new Error("Markdown 파일을 저장하지 못했습니다.")
  return { kind: "saved", file: fileSchema.parse(payload) }
}

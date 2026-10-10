import ky from "ky"
import { z } from "zod"
import type { BlockDocument } from "../core/types"

const noticeSchema = z.object({
  id: z.string(),
  revision: z.string(),
  text: z.string().max(10_000),
})
export const loadNotice = async (document: BlockDocument) => {
  const notice = noticeSchema.parse(
    await ky.get("/api/notices/current", { timeout: 5000, retry: 0 }).json(),
  )
  const block = {
    id: notice.id,
    type: "paragraph",
    attrs: {},
    content: [{ kind: "text" as const, text: notice.text, marks: [] }],
  }
  const present = document.blocks.some((existing) => existing.id === notice.id)
  return {
    requestId: `${notice.id}:${notice.revision}`,
    document: {
      ...document,
      blocks: present
        ? document.blocks.map((existing) => (existing.id === notice.id ? block : existing))
        : [...document.blocks, block],
    },
  }
}

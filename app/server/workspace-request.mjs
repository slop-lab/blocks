import { pageSchema } from "@slop-lab/blocks-workspace"
import { z } from "zod"

const MAX_BODY = 512 * 1024

export const updateSchema = z
  .object({ expectedRevision: z.number().int().positive().optional(), content: z.json() })
  .strict()

export const createPageSchema = z
  .object({
    expectedTreeRevision: z.number().int().positive(),
    page: pageSchema.omit({ archived: true }),
  })
  .strict()

export const sendWorkspaceResponse = (response, status, payload) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  response.end(JSON.stringify(payload))
}

export const readWorkspaceBody = async (request) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new RangeError("Request body is too large")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

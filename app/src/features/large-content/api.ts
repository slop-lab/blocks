import ky, { HTTPError } from "ky"
import type { PatchResult } from "./types"
import {
  largeContentBlockSchema,
  largeContentPageSchema,
  patchResultSchema,
  searchResultSchema,
} from "./types"

const client = ky.create({ prefix: "api/large-content", timeout: 10_000, retry: 1 })

export const largeContentApi = {
  async page(offset: number, limit: number) {
    return largeContentPageSchema.parse(
      await client.get("", { searchParams: { offset, limit } }).json(),
    )
  },
  async block(id: string) {
    return largeContentBlockSchema.parse(await client.get(`block/${encodeURIComponent(id)}`).json())
  },
  async search(query: string) {
    return searchResultSchema.parse(
      await client.get("search", { searchParams: { q: query } }).json(),
    ).results
  },
  async patch(id: string, expectedRevision: number, text: string): Promise<PatchResult> {
    try {
      return patchResultSchema.parse(
        await client
          .patch(`block/${encodeURIComponent(id)}`, {
            json: { expectedRevision, text },
          })
          .json(),
      )
    } catch (error) {
      if (error instanceof HTTPError && error.response.status === 409)
        return patchResultSchema.parse(await error.response.json())
      throw error
    }
  },
  exportUrl: "/api/large-content/export",
} as const

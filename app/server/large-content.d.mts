import type { IncomingMessage, ServerResponse } from "node:http"

export type ServerBlock = Readonly<{ id: string; index: number; revision: number; text: string }>
export type LargeContentRepository = Readonly<{
  page(offset: number, limit: number): Readonly<{ blocks: readonly ServerBlock[]; offset: number; total: number; continuation: number | null }>
  block(id: string): ServerBlock | null
  search(query: string, limit?: number): readonly ServerBlock[]
  patch(id: string, expectedRevision: number, text: string):
    | Readonly<{ kind: "updated"; block: ServerBlock }>
    | Readonly<{ kind: "conflict"; current: ServerBlock; draft: string }>
    | Readonly<{ kind: "missing" }>
  exportDocument(): Readonly<{ format: "large-content/v1"; blocks: readonly ServerBlock[] }>
}>

export function createLargeContentRepository(count?: number): LargeContentRepository
export function handleLargeContent(request: IncomingMessage, response: ServerResponse): Promise<boolean>

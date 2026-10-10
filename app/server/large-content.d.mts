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
export type DurableLargeContentRepository = Readonly<{
  page(offset: number, limit: number): Promise<Readonly<{ blocks: readonly ServerBlock[]; offset: number; total: number; continuation: number | null }>>
  block(id: string): Promise<ServerBlock | null>
  search(query: string, limit?: number): Promise<readonly ServerBlock[]>
  patch(id: string, expectedRevision: number, text: string): Promise<
    | Readonly<{ kind: "updated"; block: ServerBlock }>
    | Readonly<{ kind: "conflict"; current: ServerBlock | null; draft: string }>
    | Readonly<{ kind: "missing" }>
  >
  exportDocument(): Promise<Readonly<{ format: "large-content/v1"; blocks: readonly ServerBlock[] }>>
}>

export function createDurableLargeContentRepository(options: { readonly root: string; readonly count?: number }): DurableLargeContentRepository
export function createLargeContentHandler(options: { readonly root: string }):
  (request: IncomingMessage, response: ServerResponse) => Promise<boolean>

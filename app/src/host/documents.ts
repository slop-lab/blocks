import { DocumentCodecError, decodeDocument } from "../core/codec"
import type { BlockDocument, ChangeEvent } from "../core/types"
import { noteSeed, presentationSeed, readonlySeed } from "../data/seeds"
import { sanitizeHostDocument } from "./store"

export type ContentRoute = "note" | "presentation" | "readonly"

export type WorkspaceSession = {
  readonly document: BlockDocument
  readonly baseline: BlockDocument
  readonly version: number
  readonly epoch: number
  readonly surfaceRevision: number
  readonly events: readonly ChangeEvent[]
}

export type WorkspaceSessions = Readonly<Record<ContentRoute, WorkspaceSession>>

const seeds: Readonly<Record<ContentRoute, BlockDocument>> = {
  note: noteSeed,
  presentation: presentationSeed,
  readonly: readonlySeed,
}

const storageKey = (route: ContentRoute) => `slate-foundation-document-${route}`

const loadDocument = (storage: Storage, route: ContentRoute): BlockDocument => {
  const stored = storage.getItem(storageKey(route))
  if (stored === null) return seeds[route]
  try {
    return sanitizeHostDocument(decodeDocument(JSON.parse(stored)))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof DocumentCodecError) return seeds[route]
    throw error
  }
}

export const loadWorkspaceSessions = (storage: Storage): WorkspaceSessions => {
  const note = loadDocument(storage, "note")
  const presentation = loadDocument(storage, "presentation")
  const readonly = loadDocument(storage, "readonly")
  return {
    note: { document: note, baseline: note, version: 0, epoch: 1, surfaceRevision: 0, events: [] },
    presentation: {
      document: presentation,
      baseline: presentation,
      version: 0,
      epoch: 1,
      surfaceRevision: 0,
      events: [],
    },
    readonly: {
      document: readonly,
      baseline: readonly,
      version: 0,
      epoch: 1,
      surfaceRevision: 0,
      events: [],
    },
  }
}

export const persistDocument = (
  storage: Storage,
  route: ContentRoute,
  document: BlockDocument,
): void => {
  storage.setItem(storageKey(route), JSON.stringify(sanitizeHostDocument(document)))
}

export const resetDocument = (route: ContentRoute): BlockDocument => seeds[route]

export const replaceSessionDocument = (
  session: WorkspaceSession,
  document: BlockDocument,
): WorkspaceSession => ({
  ...session,
  document: sanitizeHostDocument(document),
  epoch: session.epoch + 1,
  version: 0,
  surfaceRevision: session.surfaceRevision + 1,
  events: [],
})

export const createReviewDocument = (document: BlockDocument): BlockDocument => ({
  ...document,
  blocks: [
    ...document.blocks,
    {
      id: `review-${crypto.randomUUID()}`,
      type: "paragraph",
      attrs: {},
      content: [
        {
          kind: "text",
          text: "At the next meeting, everyone could introduce one book they recommend.",
          marks: [],
        },
      ],
    },
  ],
})

export const isContentRoute = (route: string): route is ContentRoute =>
  route === "note" || route === "presentation" || route === "readonly"

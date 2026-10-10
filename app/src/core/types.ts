export type TextInline = Readonly<Record<string, unknown>> & {
  readonly kind: "text"
  readonly text: string
  readonly marks: readonly unknown[]
}

export type OpaqueInline = Readonly<Record<string, unknown>> & {
  readonly kind: "opaque"
  readonly raw: unknown
}
export type InlineSnapshot = TextInline | OpaqueInline

export type BlockSnapshot = Readonly<Record<string, unknown>> & {
  readonly id: string
  readonly type: string
  readonly schemaVersion?: unknown
  readonly attrs: Readonly<Record<string, unknown>>
  readonly content: readonly InlineSnapshot[]
  readonly locked?: boolean
}

export type BlockDocument = Readonly<Record<string, unknown>> & {
  readonly format: "block-editor/v0.3"
  readonly schemaVersion?: unknown
  readonly blocks: readonly BlockSnapshot[]
}

export type ViewData = Readonly<Record<string, unknown>>
export type OverlayState = Readonly<Record<string, unknown>>
export type SessionUIState = {
  readonly selectedBlockId: string | null
  readonly inspectorOpen: boolean
}
export type SurfaceState = {
  readonly ui: SessionUIState
  readonly overlays: OverlayState
}

export type ChangeOrigin = "local" | "remote" | "host" | "review" | "reset" | "history"

export type ChangeEvent = {
  readonly origin: ChangeOrigin
  readonly version: number
  readonly epoch: number
  readonly changeId: string
  readonly historyGroup: string | null
  readonly changedBlockIds: readonly string[]
  readonly modelId?: string
  readonly beforeVersion?: number
  readonly causeId?: string
  readonly patch?: unknown
}

export type Capability = {
  readonly id: string
  readonly available: boolean
  readonly reason: string | null
}

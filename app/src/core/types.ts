export type {
  BlockDocument,
  BlockSnapshot,
  InlineSnapshot,
  OpaqueInline,
  TextInline,
} from "@block-editor/model"

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

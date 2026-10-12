import type { ReactNode } from "react"

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
  readonly children?: readonly BlockSnapshot[] | undefined
  readonly locked?: boolean | undefined
}

export type BlockDocument = Readonly<Record<string, unknown>> & {
  readonly format: "block-editor/v0.3"
  readonly schemaVersion?: unknown
  readonly blocks: readonly BlockSnapshot[]
}

export type BlockRenderer = (block: BlockSnapshot, viewData: unknown) => ReactNode

export type BlockDefinition = {
  readonly type: string
  readonly text: boolean
  readonly render?: BlockRenderer
}

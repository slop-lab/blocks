import type { BlockDefinition } from "@slop-lab/blocks"
import type { NodeSpec, Schema } from "prosemirror-model"

export type InsertMenuItem = {
  readonly label: string
  readonly description: string
  readonly keywords: readonly string[]
  readonly attrs?: Readonly<Record<string, unknown>>
}

export type BlockRegistration = BlockDefinition & {
  readonly nodeName: string
  readonly nodeSpec: NodeSpec
  readonly referenceAttrs?: readonly string[]
  readonly container?: "titled" | "body"
  readonly titleNodeName?: string
  readonly insertMenu?: readonly InsertMenuItem[]
}

export type ProseMirrorProfile = {
  readonly schema: Schema
  readonly registrations: ReadonlyMap<string, BlockRegistration>
  readonly registrationsByNode: ReadonlyMap<string, BlockRegistration>
  readonly defaultTextType: string
}

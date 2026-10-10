import type { BlockDefinition } from "@block-editor/model"
import type { NodeSpec, Schema } from "prosemirror-model"

export type BlockRegistration = BlockDefinition & {
  readonly nodeName: string
  readonly nodeSpec: NodeSpec
  readonly referenceAttrs?: readonly string[]
}

export type ProseMirrorProfile = {
  readonly schema: Schema
  readonly registrations: ReadonlyMap<string, BlockRegistration>
  readonly registrationsByNode: ReadonlyMap<string, BlockRegistration>
  readonly defaultTextType: string
}

import {
  attachBlockSelection as attachAdapter,
  type BlockSelectionController,
  type BlockSelectionOptions,
} from "@slop-lab/blocks-interactions/prosemirror"
import type { EditorView } from "prosemirror-view"
import { profileForState } from "./profile-plugin"

export type { BlockSelectionController, BlockSelectionOptions }

export const attachBlockSelection = (
  view: EditorView,
  options: BlockSelectionOptions,
): BlockSelectionController =>
  attachAdapter(view, {
    ...options,
    referenceAttrsForNode: (node) =>
      profileForState(view.state)?.registrationsByNode.get(node.type.name)?.referenceAttrs ?? [],
  })

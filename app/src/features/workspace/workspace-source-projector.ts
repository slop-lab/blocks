import { DOMSerializer } from "prosemirror-model"
import type { EditorState } from "prosemirror-state"

export const renderSourceProjection = (state: EditorState, projection: HTMLElement): void => {
  const fragment = DOMSerializer.fromSchema(state.schema).serializeFragment(state.doc.content, {
    document: projection.ownerDocument,
  })
  projection.replaceChildren(fragment)
  for (const element of projection.querySelectorAll<HTMLElement>("[data-block-id]")) {
    const blockId = element.dataset["blockId"]
    if (blockId !== undefined) element.dataset["sourceBlockId"] = blockId
    delete element.dataset["blockId"]
  }
}

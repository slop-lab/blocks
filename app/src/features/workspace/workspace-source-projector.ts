import { headingLevelAtDepth } from "@slop-lab/blocks-workspace"
import { DOMSerializer } from "prosemirror-model"
import type { EditorState } from "prosemirror-state"

export const renderSourceProjection = (
  state: EditorState,
  projection: HTMLElement,
  embeddingDepth: number,
): void => {
  const fragment = DOMSerializer.fromSchema(state.schema).serializeFragment(state.doc.content, {
    document: projection.ownerDocument,
  })
  projection.replaceChildren(fragment)
  for (const title of projection.querySelectorAll<HTMLElement>("[data-section-title]")) {
    let sectionCount = 0
    let section = title.parentElement?.closest("section") ?? null
    while (section !== null && projection.contains(section)) {
      sectionCount += 1
      section = section.parentElement?.closest("section") ?? null
    }
    const level = headingLevelAtDepth(1, embeddingDepth + Math.max(0, sectionCount - 1))
    title.setAttribute("role", "heading")
    title.setAttribute("aria-level", String(level))
  }
  for (const element of projection.querySelectorAll<HTMLElement>("[data-block-id]")) {
    const blockId = element.dataset["blockId"]
    if (blockId !== undefined) element.dataset["sourceBlockId"] = blockId
    delete element.dataset["blockId"]
  }
}

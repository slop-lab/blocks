import type { Node as ProseMirrorNode } from "prosemirror-model"
import { Decoration, DecorationSet } from "prosemirror-view"
import type { WorkspaceFocusTarget } from "./workspace-focus-navigation"

type NodeRange = {
  readonly from: number
  readonly to: number
}

const targetRange = (document: ProseMirrorNode, target: WorkspaceFocusTarget): NodeRange | null => {
  let result: NodeRange | null = null
  document.descendants((node, position) => {
    const matches =
      target.kind === "local"
        ? node.attrs["id"] === target.blockId
        : node.attrs["occurrenceId"] === target.occurrenceId
    if (matches) {
      result = { from: position, to: position + node.nodeSize }
      return false
    }
    return result === null
  })
  return result
}

export const workspaceFocusDecorations = (
  document: ProseMirrorNode,
  target: WorkspaceFocusTarget | null,
): DecorationSet | null => {
  if (target === null) return null
  const focused = targetRange(document, target)
  if (focused === null) return null
  const decorations: Decoration[] = []
  document.descendants((node, position) => {
    if (typeof node.attrs["id"] !== "string") return true
    const range = { from: position, to: position + node.nodeSize }
    const containsFocus = range.from <= focused.from && range.to >= focused.to
    const insideFocus = focused.from <= range.from && focused.to >= range.to
    if (!containsFocus && !insideFocus)
      decorations.push(
        Decoration.node(range.from, range.to, {
          class: "workspace-focus-hidden",
          "aria-hidden": "true",
        }),
      )
    return containsFocus || insideFocus
  })
  return DecorationSet.create(document, decorations)
}

export const sharedFocusDecorations = (
  document: ProseMirrorNode,
  target: WorkspaceFocusTarget | null,
  occurrenceId: string | null,
): DecorationSet | null =>
  workspaceFocusDecorations(
    document,
    target?.kind === "shared" && target.occurrenceId === occurrenceId
      ? { kind: "local", blockId: target.blockId }
      : null,
  )

const sharedOccurrence = (root: HTMLElement, occurrenceId: string): HTMLElement | null =>
  root.matches(".structured-sync[data-occurrence-id]") &&
  root.dataset["occurrenceId"] === occurrenceId
    ? root
    : ([...root.querySelectorAll<HTMLElement>(".structured-sync[data-occurrence-id]")].find(
        (element) => element.dataset["occurrenceId"] === occurrenceId,
      ) ?? null)

export const applySharedFocusVisibility = (
  root: HTMLElement,
  target: WorkspaceFocusTarget | null,
): void => {
  for (const element of root.querySelectorAll<HTMLElement>(".workspace-focus-shared-hidden"))
    element.classList.remove("workspace-focus-shared-hidden")
  if (target?.kind !== "shared") return
  const occurrence = sharedOccurrence(root, target.occurrenceId)
  if (occurrence === null) return
  const blocks = [
    ...occurrence.querySelectorAll<HTMLElement>("[data-block-id], [data-source-block-id]"),
  ]
  const focused = blocks.find(
    (element) =>
      (element.dataset["blockId"] ?? element.dataset["sourceBlockId"]) === target.blockId,
  )
  if (focused === undefined) return
  for (const block of blocks)
    if (block !== focused && !block.contains(focused) && !focused.contains(block))
      block.classList.add("workspace-focus-shared-hidden")
}

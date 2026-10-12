import type { EditorView } from "prosemirror-view"

type ClipboardSelection = {
  readonly mode: "none" | "text" | "blocks"
  readonly value: readonly string[]
}

type ContextClipboardOptions = {
  readonly view: EditorView
  readonly selection: ClipboardSelection
  readonly isActive: () => boolean
  readonly isContextTarget: (target: Node) => boolean
  readonly copy: (event: ClipboardEvent) => void
  readonly cut: (event: ClipboardEvent) => void
  readonly paste: (event: ClipboardEvent) => void
}

const isNativeEditingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(
    'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
  ) !== null

export const attachContextClipboard = (options: ContextClipboardOptions): (() => void) => {
  const ownerDocument = options.view.dom.ownerDocument
  const route = (event: ClipboardEvent, handler: (event: ClipboardEvent) => void) => {
    const target = event.target
    if (
      options.selection.mode !== "blocks" ||
      options.selection.value.length === 0 ||
      !options.isActive() ||
      !(target instanceof Node) ||
      options.view.dom.contains(target) ||
      isNativeEditingTarget(target) ||
      !options.isContextTarget(target)
    )
      return
    handler(event)
  }
  const onCopy = (event: ClipboardEvent) => route(event, options.copy)
  const onCut = (event: ClipboardEvent) => route(event, options.cut)
  const onPaste = (event: ClipboardEvent) => route(event, options.paste)
  ownerDocument.addEventListener("copy", onCopy, true)
  ownerDocument.addEventListener("cut", onCut, true)
  ownerDocument.addEventListener("paste", onPaste, true)
  return () => {
    ownerDocument.removeEventListener("copy", onCopy, true)
    ownerDocument.removeEventListener("cut", onCut, true)
    ownerDocument.removeEventListener("paste", onPaste, true)
  }
}

import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"
import {
  BLOCK_CLIPBOARD_MIME,
  type ClipboardEnvelope,
  type ClipboardPolicy,
  decodeBlockClipboard,
  encodeBlockClipboard,
  routeCut,
} from "./index.js"
import { attachContextClipboard } from "./prosemirror-clipboard-context.js"
import {
  cloneBlockNode,
  externalReferencesForNodes,
  type InsertionBookmark,
  insertionPositionAtCaret,
  locatedBlockNodes,
  resolveInsertionBookmark,
  selectedBlockIdsInDocumentOrder,
  selectedBlockNodes,
  selectionContainsLockedNode,
} from "./prosemirror-document.js"

export type ReferencePasteContext = {
  readonly view: EditorView
  readonly insertion: number
}

export type ClipboardInteractionContext = {
  readonly modelId: string
  readonly epoch: number
  readonly version: number
}

export type ProseMirrorClipboardOptions = {
  readonly clipboard: ClipboardPolicy
  readonly isActive?: () => boolean
  readonly isContextTarget?: (target: Node) => boolean
  readonly interactionContext?: () => ClipboardInteractionContext
  readonly referenceAttrsForNode?: (node: ProseMirrorNode) => readonly string[]
  readonly onDeferredCut?: (
    blockIds: readonly string[],
    envelope: ClipboardEnvelope,
    context: ClipboardInteractionContext | null,
  ) => void | Promise<void>
  readonly onReferencePaste?: (envelope: ClipboardEnvelope, context: ReferencePasteContext) => void
  readonly onUnavailable?: (message: string) => void
}

type ClipboardControllerOptions = ProseMirrorClipboardOptions & {
  readonly selection: {
    readonly mode: "none" | "text" | "blocks"
    readonly value: readonly string[]
  }
  readonly clear: () => void
}

const writeClipboard = (event: ClipboardEvent, json: string, text: string): Promise<void> => {
  try {
    event.clipboardData?.setData(BLOCK_CLIPBOARD_MIME, json)
    event.clipboardData?.setData("text/plain", text)
    return Promise.resolve()
  } catch (error) {
    if (error instanceof DOMException) return Promise.reject(error)
    throw error
  }
}

export const attachProseMirrorClipboard = (
  view: EditorView,
  options: ClipboardControllerOptions,
): (() => void) => {
  const referenceAttrs = options.referenceAttrsForNode ?? (() => [])
  let insertionBookmark: InsertionBookmark | null = null

  const removeSelected = (
    blockIds: readonly string[],
    sourceDocument: ProseMirrorNode,
    sourceContext: ClipboardInteractionContext | null,
  ): InsertionBookmark | null => {
    const currentContext = options.interactionContext?.() ?? null
    const contextCurrent =
      sourceContext === null ||
      (currentContext !== null &&
        currentContext.modelId === sourceContext.modelId &&
        currentContext.epoch === sourceContext.epoch &&
        currentContext.version === sourceContext.version)
    if (view.state.doc !== sourceDocument || !contextCurrent) {
      options.onUnavailable?.("The document changed, so the cut was canceled.")
      return null
    }
    const selected = new Set(blockIds)
    const located = locatedBlockNodes(view.state.doc).filter(({ id }) => selected.has(id))
    if (located.length === 0 || selectionContainsLockedNode(view.state.doc, blockIds)) return null
    const position = Math.min(...located.map((item) => item.position))
    let transaction = view.state.tr
    for (const item of [...located].sort((left, right) => right.position - left.position))
      transaction = transaction.delete(item.position, item.position + item.node.nodeSize)
    if (transaction.doc.childCount === 0) return null
    view.dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    options.clear()
    return { document: view.state.doc, position }
  }

  const copy = (event: ClipboardEvent, cut: boolean) => {
    if (
      options.isActive?.() === false ||
      options.selection.mode !== "blocks" ||
      options.selection.value.length === 0 ||
      event.clipboardData === null
    )
      return
    const selected = new Set(selectedBlockIdsInDocumentOrder(view, options.selection))
    const nodes = locatedBlockNodes(view.state.doc)
      .filter(({ id }) => selected.has(id))
      .map(({ node }) => node)
    const envelope: ClipboardEnvelope = {
      namespace: options.clipboard.namespace,
      blocks: nodes.map((node) => node.toJSON()),
      externalReferences: externalReferencesForNodes(nodes, referenceAttrs),
    }
    const encoded = encodeBlockClipboard(envelope, () =>
      nodes.map((node) => node.textContent).join("\n"),
    )
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!cut) {
      void writeClipboard(event, encoded.json, encoded.text).catch(() =>
        options.onUnavailable?.("Unable to copy to the clipboard."),
      )
      return
    }
    const blockIds = selectedBlockIdsInDocumentOrder(view, options.selection)
    const sourceDocument = view.state.doc
    const currentContext = options.interactionContext?.()
    const sourceContext = currentContext === undefined ? null : { ...currentContext }
    const routed = routeCut({
      policy: options.clipboard.cut,
      write: () => writeClipboard(event, encoded.json, encoded.text),
      remove: () => {
        insertionBookmark = removeSelected(blockIds, sourceDocument, sourceContext)
      },
      markPending: () => {
        void Promise.resolve(options.onDeferredCut?.(blockIds, envelope, sourceContext)).catch(() =>
          options.onUnavailable?.("The host could not complete the cut request."),
        )
      },
    })
    void routed.completion.then((result) => {
      if (result.kind === "write-failed")
        options.onUnavailable?.("Clipboard access was denied, so the original content was kept.")
    })
  }

  const paste = (event: ClipboardEvent) => {
    if (options.isActive?.() === false || event.clipboardData === null) return
    const decoded = decodeBlockClipboard(event.clipboardData.getData(BLOCK_CLIPBOARD_MIME))
    if (decoded.kind !== "valid") return
    const parsed: ProseMirrorNode[] = []
    for (const raw of decoded.envelope.blocks) {
      if (typeof raw !== "object" || raw === null) {
        options.onUnavailable?.("The clipboard block format is invalid.")
        return
      }
      try {
        const node = view.state.schema.nodeFromJSON(raw)
        node.check()
        parsed.push(node)
      } catch (error) {
        if (error instanceof RangeError) {
          options.onUnavailable?.("The block cannot be opened with the current document schema.")
          return
        }
        throw error
      }
    }
    if (parsed.length === 0) return
    if (!view.state.schema.topNodeType.validContent(Fragment.fromArray(parsed))) {
      options.onUnavailable?.("Clipboard blocks cannot be inserted at the document root.")
      return
    }
    const envelope: ClipboardEnvelope = {
      namespace: decoded.envelope.namespace,
      blocks: parsed.map((node) => node.toJSON()),
      externalReferences: externalReferencesForNodes(parsed, referenceAttrs),
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    const target = selectedBlockNodes(view.state.doc, options.selection.value).at(-1)
    const bookmark = resolveInsertionBookmark(view.state.doc, insertionBookmark)
    const insertion =
      target?.position === undefined
        ? (bookmark ?? insertionPositionAtCaret(view))
        : target.position + target.node.nodeSize
    const decision = options.clipboard.paste(envelope, {
      external: envelope.namespace !== options.clipboard.namespace,
    })
    if (decision === "reject") {
      options.onUnavailable?.("This document does not allow those blocks to be pasted.")
      return
    }
    if (decision === "link") {
      if (options.onReferencePaste === undefined)
        options.onUnavailable?.("This editor does not support pasting by reference.")
      else options.onReferencePaste(envelope, { view, insertion })
      return
    }
    const identities = new Map<string, string>()
    const remember = (node: ProseMirrorNode) => {
      const id = node.attrs["id"]
      if (typeof id === "string") identities.set(id, crypto.randomUUID())
      node.forEach(remember)
    }
    for (const node of parsed) remember(node)
    view.dispatch(
      view.state.tr
        .insert(
          insertion,
          Fragment.fromArray(
            parsed.map((node) => cloneBlockNode(node, identities, referenceAttrs)),
          ),
        )
        .setMeta("origin", "paste")
        .scrollIntoView(),
    )
    insertionBookmark = null
    options.clear()
  }

  const onCopy = (event: ClipboardEvent) => copy(event, false)
  const onCut = (event: ClipboardEvent) => copy(event, true)
  const detachContextClipboard =
    options.isContextTarget === undefined
      ? () => undefined
      : attachContextClipboard({
          view,
          selection: options.selection,
          isActive: () => options.isActive?.() ?? true,
          isContextTarget: options.isContextTarget,
          copy: onCopy,
          cut: onCut,
          paste,
        })
  view.dom.addEventListener("copy", onCopy, true)
  view.dom.addEventListener("cut", onCut, true)
  view.dom.addEventListener("paste", paste, true)
  return () => {
    detachContextClipboard()
    view.dom.removeEventListener("copy", onCopy, true)
    view.dom.removeEventListener("cut", onCut, true)
    view.dom.removeEventListener("paste", paste, true)
  }
}

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

export type ProseMirrorClipboardOptions = {
  readonly clipboard: ClipboardPolicy
  readonly referenceAttrsForNode?: (node: ProseMirrorNode) => readonly string[]
  readonly onDeferredCut?: (
    blockIds: readonly string[],
    envelope: ClipboardEnvelope,
  ) => void | Promise<void>
  readonly onReferencePaste?: (envelope: ClipboardEnvelope, context: ReferencePasteContext) => void
  readonly onUnavailable?: (message: string) => void
}

type ClipboardControllerOptions = ProseMirrorClipboardOptions & {
  readonly selection: { readonly value: readonly string[] }
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

  const removeSelected = (): InsertionBookmark | null => {
    const selected = new Set(selectedBlockIdsInDocumentOrder(view, options.selection))
    const located = locatedBlockNodes(view.state.doc).filter(({ id }) => selected.has(id))
    if (
      located.length === 0 ||
      selectionContainsLockedNode(view.state.doc, options.selection.value)
    )
      return null
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
    if (options.selection.value.length === 0 || event.clipboardData === null) return
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
        options.onUnavailable?.("클립보드에 복사할 수 없습니다."),
      )
      return
    }
    const blockIds = selectedBlockIdsInDocumentOrder(view, options.selection)
    const routed = routeCut({
      policy: options.clipboard.cut,
      write: () => writeClipboard(event, encoded.json, encoded.text),
      remove: () => {
        insertionBookmark = removeSelected()
      },
      markPending: () => {
        void options.onDeferredCut?.(blockIds, envelope)
      },
    })
    void routed.completion.then((result) => {
      if (result.kind === "write-failed")
        options.onUnavailable?.("클립보드 쓰기가 거부되어 원본을 유지했습니다.")
    })
  }

  const paste = (event: ClipboardEvent) => {
    if (event.clipboardData === null) return
    const decoded = decodeBlockClipboard(event.clipboardData.getData(BLOCK_CLIPBOARD_MIME))
    if (decoded.kind !== "valid") return
    event.preventDefault()
    event.stopImmediatePropagation()
    const target = selectedBlockNodes(view.state.doc, options.selection.value).at(-1)
    const bookmark = resolveInsertionBookmark(view.state.doc, insertionBookmark)
    const insertion =
      target?.position === undefined
        ? (bookmark ?? insertionPositionAtCaret(view))
        : target.position + target.node.nodeSize
    const decision = options.clipboard.paste(decoded.envelope, {
      external: decoded.envelope.namespace !== options.clipboard.namespace,
    })
    if (decision === "reject") {
      options.onUnavailable?.("이 문서에서는 해당 블록 붙여넣기를 허용하지 않습니다.")
      return
    }
    if (decision === "link") {
      if (options.onReferencePaste === undefined)
        options.onUnavailable?.("이 편집기는 참조 붙여넣기를 지원하지 않습니다.")
      else options.onReferencePaste(decoded.envelope, { view, insertion })
      return
    }
    const parsed: ProseMirrorNode[] = []
    for (const raw of decoded.envelope.blocks) {
      if (typeof raw !== "object" || raw === null) {
        options.onUnavailable?.("클립보드 블록 형식이 올바르지 않습니다.")
        return
      }
      try {
        parsed.push(view.state.schema.nodeFromJSON(raw))
      } catch (error) {
        if (error instanceof RangeError) {
          options.onUnavailable?.("현재 문서 스키마에서 블록을 열 수 없습니다.")
          return
        }
        throw error
      }
    }
    if (parsed.length === 0) return
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
  view.dom.addEventListener("copy", onCopy, true)
  view.dom.addEventListener("cut", onCut, true)
  view.dom.addEventListener("paste", paste, true)
  return () => {
    view.dom.removeEventListener("copy", onCopy, true)
    view.dom.removeEventListener("cut", onCut, true)
    view.dom.removeEventListener("paste", paste, true)
  }
}

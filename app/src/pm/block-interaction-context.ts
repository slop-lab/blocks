import { InteractionContextArbiter } from "@slop-lab/blocks-interactions"
import type { EditorView } from "prosemirror-view"
import type { BlockInteractionOptions } from "./block-interaction-options"

const documentScopes = new WeakMap<Document, InteractionContextArbiter>()
let contextSequence = 0

const defaultScope = (document: Document): InteractionContextArbiter => {
  const existing = documentScopes.get(document)
  if (existing !== undefined) return existing
  const scope = new InteractionContextArbiter()
  documentScopes.set(document, scope)
  return scope
}

export const interactionContextFor = (view: EditorView, options: BlockInteractionOptions) => {
  contextSequence += 1
  const context = (options.scope ?? defaultScope(view.dom.ownerDocument)).context(
    options.contextId ?? `prosemirror:${contextSequence}`,
  )
  return {
    isActive: options.isActive ?? context.isActive,
    claim: options.claim ?? context.claim,
    release: options.release ?? (options.isActive === undefined ? context.release : undefined),
    subscribeActive: options.subscribeActive ?? context.subscribe,
  }
}

export const blockTargetsFor = (view: EditorView) => {
  const ownsBlock = (block: HTMLElement): boolean => block.closest(".ProseMirror") === view.dom
  const ownedBlockById = (id: string): HTMLElement | null =>
    Array.from(view.dom.querySelectorAll<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)).find(
      ownsBlock,
    ) ?? null
  return { ownsBlock, ownedBlockById }
}

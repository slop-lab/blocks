import { blockSelectionReconcilePlugin } from "@slop-lab/blocks-interactions/prosemirror"
import { parseMarkdown, serializeMarkdown } from "@slop-lab/blocks-markdown"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules"
import { keymap } from "prosemirror-keymap"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { createIdentityPlugin, createLockedBlockPlugin } from "../../pm/editor"

export type MarkdownRichEditorHandle = {
  readonly resetSource: (source: string) => void
  readonly source: () => string | null
}

type MarkdownRichEditorProps = {
  readonly source: string
  readonly hidden: boolean
  readonly onChange: (source: string) => void
  readonly onCompositionChange: (active: boolean) => void
  readonly onSave: () => void
}

export const createMarkdownEditorState = (
  document: ProseMirrorNode,
  onSave: () => void = () => undefined,
): EditorState => {
  const { schema } = document.type
  const paragraph = schema.nodes["paragraph"]
  const heading = schema.nodes["heading"]
  const blockquote = schema.nodes["blockquote"]
  const bulletList = schema.nodes["bullet_list"]
  const orderedList = schema.nodes["ordered_list"]
  const listItem = schema.nodes["list_item"]
  const strong = schema.marks["strong"]
  const emphasis = schema.marks["em"]
  if (
    paragraph === undefined ||
    heading === undefined ||
    blockquote === undefined ||
    bulletList === undefined ||
    orderedList === undefined ||
    listItem === undefined ||
    strong === undefined ||
    emphasis === undefined
  )
    throw new TypeError("Markdown schema is incomplete")
  return EditorState.create({
    schema,
    doc: document,
    plugins: [
      history(),
      createLockedBlockPlugin(),
      createIdentityPlugin(),
      blockSelectionReconcilePlugin,
      inputRules({
        rules: [
          textblockTypeInputRule(/^(#{1,6})\s$/u, heading, (match) => ({
            level: match[1]?.length ?? 1,
          })),
          wrappingInputRule(/^>\s$/u, blockquote),
          wrappingInputRule(/^\s*([-+*])\s$/u, bulletList),
          wrappingInputRule(/^\s*(\d+)\.\s$/u, orderedList, (match) => ({
            order: Number(match[1] ?? "1"),
          })),
        ],
      }),
      keymap({
        "Mod-b": toggleMark(strong),
        "Mod-i": toggleMark(emphasis),
        "Mod-z": undo,
        "Mod-Shift-z": redo,
        "Mod-y": redo,
        "Mod-s": () => {
          onSave()
          return true
        },
        Enter: splitListItem(listItem),
        Tab: sinkListItem(listItem),
        "Shift-Tab": liftListItem(listItem),
      }),
      keymap(baseKeymap),
    ],
  })
}

export const MarkdownRichEditor = forwardRef<MarkdownRichEditorHandle, MarkdownRichEditorProps>(
  function MarkdownRichEditor({ source, hidden, onChange, onCompositionChange, onSave }, ref) {
    const host = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)
    const onCompositionRef = useRef(onCompositionChange)
    const onSaveRef = useRef(onSave)
    const initialSource = useRef(source)
    const composingRef = useRef(false)
    const pendingSourceRef = useRef<string | null>(null)
    const resetTimerRef = useRef<number | null>(null)
    onChangeRef.current = onChange
    onCompositionRef.current = onCompositionChange
    onSaveRef.current = onSave

    const resetSource = useCallback((nextSource: string) => {
      const view = viewRef.current
      if (view === null) return
      if (composingRef.current || view.composing) {
        pendingSourceRef.current = nextSource
        return
      }
      pendingSourceRef.current = null
      view.updateState(
        createMarkdownEditorState(parseMarkdown(nextSource).document, () => onSaveRef.current()),
      )
    }, [])

    useImperativeHandle(ref, () => ({
      resetSource: (nextSource) => {
        resetSource(nextSource)
      },
      source: () => {
        const view = viewRef.current
        return view === null ? null : serializeMarkdown(view.state.doc)
      },
    }))

    useEffect(() => {
      const target = host.current
      if (target === null) return
      const view = new EditorView(target, {
        state: createMarkdownEditorState(parseMarkdown(initialSource.current).document, () =>
          onSaveRef.current(),
        ),
        attributes: {
          class: "markdown-prose",
          "aria-label": "Markdown document editor",
        },
        dispatchTransaction: (transaction) => {
          const previous = view.state.doc
          const result = view.state.applyTransaction(transaction)
          if (result.transactions.length === 0) return
          view.updateState(result.state)
          if (!result.state.doc.eq(previous))
            onChangeRef.current(serializeMarkdown(result.state.doc))
        },
      })
      const composing = (active: boolean) => onCompositionRef.current(active)
      const start = () => {
        composingRef.current = true
        composing(true)
      }
      const end = () => {
        composingRef.current = false
        composing(false)
        resetTimerRef.current =
          view.dom.ownerDocument.defaultView?.setTimeout(() => {
            resetTimerRef.current = null
            const pending = pendingSourceRef.current
            if (pending !== null) resetSource(pending)
          }, 0) ?? null
      }
      view.dom.addEventListener("compositionstart", start)
      view.dom.addEventListener("compositionend", end)
      const detach = attachBlockInteractions(view, { readOnly: false })
      viewRef.current = view
      return () => {
        if (resetTimerRef.current !== null)
          view.dom.ownerDocument.defaultView?.clearTimeout(resetTimerRef.current)
        detach()
        view.dom.removeEventListener("compositionstart", start)
        view.dom.removeEventListener("compositionend", end)
        view.destroy()
        viewRef.current = null
      }
    }, [resetSource])

    useEffect(() => {
      const view = viewRef.current
      if (view === null || serializeMarkdown(view.state.doc) === source) return
      resetSource(source)
    }, [resetSource, source])

    return (
      <section className="markdown-rich" aria-hidden={hidden} hidden={hidden}>
        <div ref={host} />
      </section>
    )
  },
)

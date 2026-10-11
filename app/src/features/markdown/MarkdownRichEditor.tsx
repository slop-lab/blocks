import { parseMarkdown, serializeMarkdown } from "@block-editor/markdown"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules"
import { keymap } from "prosemirror-keymap"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
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
}

const markdownState = (document: ProseMirrorNode): EditorState => {
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
        Enter: splitListItem(listItem),
        Tab: sinkListItem(listItem),
        "Shift-Tab": liftListItem(listItem),
      }),
      keymap(baseKeymap),
    ],
  })
}

export const MarkdownRichEditor = forwardRef<MarkdownRichEditorHandle, MarkdownRichEditorProps>(
  function MarkdownRichEditor({ source, hidden, onChange, onCompositionChange }, ref) {
    const host = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)
    const onCompositionRef = useRef(onCompositionChange)
    const initialSource = useRef(source)
    onChangeRef.current = onChange
    onCompositionRef.current = onCompositionChange

    useImperativeHandle(ref, () => ({
      resetSource: (nextSource) => {
        const view = viewRef.current
        if (view === null) return
        view.updateState(markdownState(parseMarkdown(nextSource).document))
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
        state: markdownState(parseMarkdown(initialSource.current).document),
        attributes: {
          class: "markdown-prose",
          "aria-label": "Markdown 문서 편집기",
        },
        dispatchTransaction: (transaction) => {
          const next = view.state.apply(transaction)
          view.updateState(next)
          if (transaction.docChanged) onChangeRef.current(serializeMarkdown(next.doc))
        },
      })
      const composing = (active: boolean) => onCompositionRef.current(active)
      const start = () => composing(true)
      const end = () => composing(false)
      view.dom.addEventListener("compositionstart", start)
      view.dom.addEventListener("compositionend", end)
      const detach = attachBlockInteractions(view, { readOnly: false })
      viewRef.current = view
      return () => {
        detach()
        view.dom.removeEventListener("compositionstart", start)
        view.dom.removeEventListener("compositionend", end)
        view.destroy()
        viewRef.current = null
      }
    }, [])

    useEffect(() => {
      const view = viewRef.current
      if (view === null || serializeMarkdown(view.state.doc) === source) return
      view.updateState(markdownState(parseMarkdown(source).document))
    }, [source])

    return (
      <section className="markdown-rich" aria-hidden={hidden} hidden={hidden}>
        <div ref={host} />
      </section>
    )
  },
)

import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorView as EditorViewType } from "prosemirror-view"
import { EditorView } from "prosemirror-view"
import { useEffect, useRef } from "react"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { createAttachmentFactory } from "./attachments"
import { createCompositeEditorState } from "./profile"

type ProseMirrorSurfaceProps = {
  readonly document: ProseMirrorNode
  readonly onChange: (document: ProseMirrorNode) => void
  readonly onReady: (view: EditorViewType | null) => void
  readonly onActivate: () => void
  readonly active: () => boolean
}

type ProseMirrorAttachmentContext = {
  readonly document: ProseMirrorNode
  readonly onChange: (document: ProseMirrorNode) => void
  readonly onReady: (view: EditorViewType | null) => void
  readonly onActivate: () => void
  readonly active: () => boolean
}

export const proseMirrorAttachmentFactory = createAttachmentFactory<ProseMirrorAttachmentContext>(
  (host, context) => {
    const view = new EditorView(host, {
      state: createCompositeEditorState(context.document),
      attributes: {
        class: "composite-prose",
        "aria-label": "구조화 문서와 표 편집기",
      },
      handleDOMEvents: {
        focus: () => {
          context.onActivate()
          return false
        },
        pointerdown: () => {
          context.onActivate()
          return false
        },
      },
      dispatchTransaction(transaction) {
        const next = view.state.apply(transaction)
        view.updateState(next)
        context.onChange(next.doc)
      },
    })
    const detachInteractions = attachBlockInteractions(view, {
      readOnly: false,
      active: context.active,
    })
    context.onReady(view)
    return () => {
      context.onReady(null)
      detachInteractions()
      view.destroy()
    }
  },
)

export const ProseMirrorSurface = ({
  document,
  onChange,
  onReady,
  onActivate,
  active,
}: ProseMirrorSurfaceProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const initialDocument = useRef(document)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const onActivateRef = useRef(onActivate)
  const activeRef = useRef(active)
  onChangeRef.current = onChange
  onReadyRef.current = onReady
  onActivateRef.current = onActivate
  activeRef.current = active

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const attachment = proseMirrorAttachmentFactory.attach(host, {
      document: initialDocument.current,
      onChange: (next) => onChangeRef.current(next),
      onReady: (view) => onReadyRef.current(view),
      onActivate: () => onActivateRef.current(),
      active: () => activeRef.current(),
    })
    return attachment.dispose
  }, [])

  return <div className="composite-prose-frame" ref={hostRef} />
}

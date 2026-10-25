import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { javascript } from "@codemirror/lang-javascript"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { useEffect, useRef } from "react"
import { createAttachmentFactory } from "./attachments"

type CodeAttachmentContext = {
  readonly initialCode: string
  readonly onChange: (code: string) => void
  readonly onReady: (view: EditorView | null) => void
  readonly onActivate: () => void
}

export const codeAttachmentFactory = createAttachmentFactory<CodeAttachmentContext>(
  (host, context) => {
    const state = EditorState.create({
      doc: context.initialCode,
      extensions: [
        history(),
        javascript({ typescript: true }),
        keymap.of([indentWithTab, ...historyKeymap, ...defaultKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Travel preparation code editor",
          spellcheck: "false",
        }),
        EditorView.domEventHandlers({
          focus: () => {
            context.onActivate()
            return false
          },
          pointerdown: () => {
            context.onActivate()
            return false
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) context.onChange(update.state.doc.toString())
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    context.onReady(view)
    return () => {
      context.onReady(null)
      view.destroy()
    }
  },
)

type NestedCodeEditorProps = CodeAttachmentContext

export const NestedCodeEditor = ({
  initialCode,
  onChange,
  onReady,
  onActivate,
}: NestedCodeEditorProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const initialCodeRef = useRef(initialCode)
  const changeRef = useRef(onChange)
  const readyRef = useRef(onReady)
  const activateRef = useRef(onActivate)
  changeRef.current = onChange
  readyRef.current = onReady
  activateRef.current = onActivate

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const attachment = codeAttachmentFactory.attach(host, {
      initialCode: initialCodeRef.current,
      onChange: (code) => changeRef.current(code),
      onReady: (view) => readyRef.current(view),
      onActivate: () => activateRef.current(),
    })
    return attachment.dispose
  }, [])

  return <div className="composite-code" ref={hostRef} />
}

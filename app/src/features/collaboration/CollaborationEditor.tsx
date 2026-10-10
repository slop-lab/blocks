import { baseKeymap } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { EditorState } from "prosemirror-state"
import type { EditorView as EditorViewType } from "prosemirror-view"
import { EditorView } from "prosemirror-view"
import { useEffect, useRef } from "react"
import {
  initProseMirrorDoc,
  redo,
  undo,
  yCursorPlugin,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin,
} from "y-prosemirror"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { duplicateBlock, toggleFormat } from "../../pm/commands"
import { createIdentityPlugin, createLockedBlockPlugin } from "../../pm/editor"
import { editorSchema } from "../../pm/schema"
import type { CollaborationBinding } from "./CollaborationBinding"

type CollaborationEditorProps = {
  readonly label: string
  readonly binding: CollaborationBinding
  readonly onActive: (view: EditorViewType) => void
}

export const CollaborationEditor = ({ label, binding, onActive }: CollaborationEditorProps) => {
  const mountRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(onActive)
  activeRef.current = onActive

  useEffect(() => {
    const mount = mountRef.current
    if (mount === null) return
    const initial = initProseMirrorDoc(binding.fragment, editorSchema)
    const view = new EditorView(mount, {
      state: EditorState.create({
        schema: editorSchema,
        doc: initial.doc,
        plugins: [
          ySyncPlugin(binding.fragment, { mapping: initial.mapping }),
          yCursorPlugin(binding.awareness),
          yUndoPlugin(),
          createLockedBlockPlugin(
            (transaction) => transaction.getMeta(ySyncPluginKey)?.isChangeOrigin === true,
          ),
          createIdentityPlugin((transactions) =>
            transactions.some(
              (transaction) =>
                transaction.docChanged &&
                transaction.getMeta(ySyncPluginKey)?.isChangeOrigin !== true,
            ),
          ),
          keymap({
            "Mod-b": toggleFormat("strong"),
            "Mod-i": toggleFormat("em"),
            "Mod-z": undo,
            "Mod-y": redo,
            "Mod-Shift-z": redo,
            "Mod-Shift-d": duplicateBlock,
          }),
          keymap(baseKeymap),
        ],
      }),
      attributes: { class: "editor-content", "aria-label": `${label} 공동 편집기` },
      handleDOMEvents: {
        focus: () => {
          activeRef.current(view)
          return false
        },
      },
    })
    const detachInteractions = attachBlockInteractions(view, { readOnly: false })
    activeRef.current(view)
    return () => {
      detachInteractions()
      view.destroy()
    }
  }, [binding, label])

  return <div className="collaboration-editor editor" ref={mountRef} />
}

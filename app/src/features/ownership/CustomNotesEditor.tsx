import type { BlockDocument } from "@block-editor/model"
import { EditorView } from "prosemirror-view"
import { useEffect, useRef } from "react"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { ModelSession } from "../../pm/session"
import { notesProfile } from "./notes-profile"

export const CustomNotesEditor = ({
  document,
  onChange,
}: {
  readonly document: BlockDocument
  readonly onChange: (document: BlockDocument) => void
}) => {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = host.current
    if (target === null) return
    const session = new ModelSession({
      modelId: "ownership-notebook",
      document,
      epoch: 1,
      version: 0,
      readOnly: false,
      profile: notesProfile,
    })
    const view = new EditorView(target, {
      state: session.state,
      dispatchTransaction: (transaction) => {
        session.dispatch(transaction)
        view.updateState(session.state)
      },
    })
    const detach = attachBlockInteractions(view, { readOnly: false })
    const unsubscribe = session.subscribe((event) => {
      if (event !== null) onChange(session.snapshot)
    })
    return () => {
      unsubscribe()
      detach()
      view.destroy()
      session.dispose()
    }
  }, [document, onChange])
  return <div className="ownership-editor" ref={host} />
}

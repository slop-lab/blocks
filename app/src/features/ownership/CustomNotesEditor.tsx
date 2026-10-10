import type { BlockDocument } from "@block-editor/model"
import type { ProseMirrorProfile } from "@block-editor/prosemirror"
import { EditorView } from "prosemirror-view"
import { useEffect, useRef } from "react"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { ModelSession } from "../../pm/session"
import { notesProfile } from "./notes-profile"

export const CanonicalBlockEditor = ({
  document,
  onChange,
  profile,
  modelId,
  label,
}: {
  readonly document: BlockDocument
  readonly onChange: (document: BlockDocument) => void
  readonly profile: ProseMirrorProfile
  readonly modelId: string
  readonly label: string
}) => {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = host.current
    if (target === null) return
    const session = new ModelSession({
      modelId,
      document,
      epoch: 1,
      version: 0,
      readOnly: false,
      profile,
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
  }, [document, modelId, onChange, profile])
  return <section aria-label={label} className="ownership-editor" ref={host} />
}

export const CustomNotesEditor = (props: {
  readonly document: BlockDocument
  readonly onChange: (document: BlockDocument) => void
}) => (
  <CanonicalBlockEditor
    {...props}
    profile={notesProfile}
    modelId="ownership-notebook"
    label="노트 블록 편집기"
  />
)

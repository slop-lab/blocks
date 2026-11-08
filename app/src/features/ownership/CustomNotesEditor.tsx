import type { BlockDocument } from "@slop-lab/blocks"
import type { ProseMirrorProfile } from "@slop-lab/blocks-prosemirror"
import type { Command } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import { deleteBlockById, duplicateBlockById } from "../../pm/block-interaction-commands"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { ModelSession } from "../../pm/session"
import { notesProfile } from "./notes-profile"

export type CanonicalBlockEditorHandle = {
  readonly duplicateBlock: (blockId: string) => boolean
  readonly deleteBlock: (blockId: string) => boolean
  readonly reset: (document: BlockDocument) => boolean
  readonly snapshot: () => BlockDocument | null
  readonly revision: () => number | null
}

type CanonicalBlockEditorProps = {
  readonly document: BlockDocument
  readonly onChange: (document: BlockDocument) => void
  readonly onRevision?: (revision: number) => void
  readonly profile: ProseMirrorProfile
  readonly modelId: string
  readonly label: string
  readonly onSave?: () => void
}

export const CanonicalBlockEditor = forwardRef<
  CanonicalBlockEditorHandle,
  CanonicalBlockEditorProps
>(function CanonicalBlockEditor(
  { document, onChange, onRevision, profile, modelId, label, onSave },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const initialDocument = useRef(document)
  const sessionRef = useRef<ModelSession | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onRevisionRef = useRef(onRevision)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onRevisionRef.current = onRevision
  onSaveRef.current = onSave

  const run = (command: Command): boolean => {
    const session = sessionRef.current
    const view = viewRef.current
    if (session === null || view === null) return false
    const handled = command(view.state, view.dispatch, view)
    if (handled) view.focus()
    return handled
  }
  const reset = (next: BlockDocument): boolean => {
    const session = sessionRef.current
    const view = viewRef.current
    if (session === null || view === null) return false
    const result = session.applyExternal({
      modelId,
      epoch: session.epoch,
      baseVersion: session.version,
      requestId: crypto.randomUUID(),
      document: next,
    })
    if (result.kind === "applied") view.updateState(session.state)
    return result.kind !== "conflict"
  }
  useImperativeHandle(ref, () => ({
    duplicateBlock: (blockId) => run(duplicateBlockById(blockId)),
    deleteBlock: (blockId) => run(deleteBlockById(blockId)),
    reset,
    snapshot: () => sessionRef.current?.snapshot ?? null,
    revision: () => sessionRef.current?.version ?? null,
  }))

  useEffect(() => {
    const target = host.current
    if (target === null) return
    const session = new ModelSession({
      modelId,
      document: initialDocument.current,
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
    sessionRef.current = session
    viewRef.current = view
    const detach = attachBlockInteractions(view, { readOnly: false })
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault()
        onSaveRef.current?.()
      }
    }
    view.dom.addEventListener("keydown", saveShortcut)
    const unsubscribe = session.subscribe((event) => {
      if (event !== null) {
        onChangeRef.current(session.snapshot)
        onRevisionRef.current?.(event.version)
      }
    })
    return () => {
      unsubscribe()
      detach()
      view.dom.removeEventListener("keydown", saveShortcut)
      view.destroy()
      session.dispose()
      sessionRef.current = null
      viewRef.current = null
    }
  }, [modelId, profile])
  return <section aria-label={label} className="ownership-editor" ref={host} />
})

export const CustomNotesEditor = (props: {
  readonly document: BlockDocument
  readonly onChange: (document: BlockDocument) => void
  readonly onSave?: () => void
}) => (
  <CanonicalBlockEditor
    {...props}
    profile={notesProfile}
    modelId="ownership-notebook"
    label="Note block editor"
  />
)

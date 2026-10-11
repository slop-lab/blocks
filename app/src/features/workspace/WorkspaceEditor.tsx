import type { Database, PageDocument, SyncedSource, Workspace } from "@block-editor/workspace"
import { EditorView } from "prosemirror-view"
import { useEffect, useMemo, useRef } from "react"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { ModelSession } from "../../pm/session"
import {
  createWorkspaceProfile,
  pageDocumentToSnapshot,
  snapshotToPageDocument,
} from "./workspace-editor-model"
import { createWorkspaceNodeViews } from "./workspace-node-views"

type Props = {
  readonly workspace: Workspace
  readonly document: PageDocument
  readonly depth: number
  readonly databases: readonly Database[]
  readonly sources: readonly SyncedSource[]
  readonly onDocument: (document: PageDocument) => void
  readonly onSourceEdit: (source: SyncedSource) => void
  readonly onOpenPage: (id: string) => void
  readonly onCompositionChange: (composing: boolean) => void
  readonly autoFocus?: boolean
}

export const WorkspaceEditor = (props: Props) => {
  const documentId = props.document.pageId
  const mount = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<ModelSession | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const refreshViewsRef = useRef<() => void>(() => {})
  const emittedRef = useRef("")
  const propsRef = useRef(props)
  propsRef.current = props
  const profile = useMemo(() => createWorkspaceProfile(props.depth), [props.depth])
  const dataRef = useRef({
    workspace: props.workspace,
    databases: props.databases,
    sources: props.sources,
    profile,
    onOpenPage: props.onOpenPage,
    onSourceEdit: props.onSourceEdit,
  })
  dataRef.current = {
    workspace: props.workspace,
    databases: props.databases,
    sources: props.sources,
    profile,
    onOpenPage: props.onOpenPage,
    onSourceEdit: props.onSourceEdit,
  }

  useEffect(() => {
    const target = mount.current
    if (target === null) return
    const initial = propsRef.current.document
    emittedRef.current = JSON.stringify(initial)
    const session = new ModelSession({
      modelId: documentId,
      document: pageDocumentToSnapshot(initial),
      epoch: 1,
      version: initial.version,
      readOnly: false,
      profile,
    })
    const release = session.attach()
    if (release === null) throw new TypeError("Workspace editor session is already attached")
    const workspaceViews = createWorkspaceNodeViews(dataRef)
    let compositionTimer: ReturnType<typeof setTimeout> | undefined
    const view = new EditorView(target, {
      state: session.state,
      attributes: {
        class: "editor-content structured-prosemirror",
        "aria-label": "구조화 문서 편집기",
      },
      nodeViews: workspaceViews.nodeViews,
      handleDOMEvents: {
        compositionstart: () => {
          clearTimeout(compositionTimer)
          session.setComposing(true)
          propsRef.current.onCompositionChange(true)
          return false
        },
        compositionend: () => {
          clearTimeout(compositionTimer)
          compositionTimer = setTimeout(() => {
            session.setComposing(false)
            propsRef.current.onCompositionChange(false)
          }, 0)
          return false
        },
      },
      dispatchTransaction: (transaction) => {
        session.dispatch(transaction)
      },
    })
    const unsubscribe = session.subscribe((event) => {
      view.updateState(session.state)
      if (event === null || event.origin === "host") return
      const document = snapshotToPageDocument(session.snapshot, propsRef.current.document)
      emittedRef.current = JSON.stringify(document)
      propsRef.current.onDocument(document)
    })
    const detach = attachBlockInteractions(view, { readOnly: false })
    sessionRef.current = session
    viewRef.current = view
    workspaceViews.refresh()
    if (propsRef.current.autoFocus === true) view.focus()
    refreshViewsRef.current = workspaceViews.refresh
    return () => {
      clearTimeout(compositionTimer)
      propsRef.current.onCompositionChange(false)
      unsubscribe()
      detach()
      workspaceViews.destroy()
      refreshViewsRef.current = () => {}
      release()
      view.destroy()
      session.dispose()
      sessionRef.current = null
      viewRef.current = null
    }
  }, [profile, documentId])

  useEffect(() => {
    const session = sessionRef.current
    const view = viewRef.current
    if (session === null || view === null) return
    const serialized = JSON.stringify(props.document)
    if (serialized === emittedRef.current) return
    const result = session.applyExternal({
      modelId: props.document.pageId,
      epoch: session.epoch,
      baseVersion: session.version,
      requestId: crypto.randomUUID(),
      document: pageDocumentToSnapshot(props.document),
    })
    if (result.kind === "applied") view.updateState(session.state)
  }, [props.document])

  useEffect(() => {
    Object.assign(dataRef.current, {
      workspace: props.workspace,
      databases: props.databases,
      sources: props.sources,
    })
    refreshViewsRef.current()
  }, [props.databases, props.sources, props.workspace])

  return <div className="structured-editor" ref={mount} />
}

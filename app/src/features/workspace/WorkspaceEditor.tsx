import type { Database, PageDocument, SyncedSource, Workspace } from "@block-editor/workspace"
import { Fragment } from "prosemirror-model"
import { EditorView } from "prosemirror-view"
import { useEffect, useMemo, useRef } from "react"
import { parseInternalTarget } from "../../core/links"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { ModelSession } from "../../pm/session"
import type { EntityRecord } from "./workspace-api"
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
  readonly sources: readonly EntityRecord<SyncedSource>[]
  readonly onDocument: (document: PageDocument) => void
  readonly onSourceEdit: (source: SyncedSource) => void
  readonly onSourceCreate: (source: SyncedSource) => Promise<EntityRecord<SyncedSource> | null>
  readonly onSourceCompositionChange: (sourceId: string, composing: boolean) => void
  readonly onOpenPage: (id: string, blockId?: string) => void
  readonly onCompositionChange: (composing: boolean) => void
  readonly pasteMode: "clone" | "reference"
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
    onSourceCreate: props.onSourceCreate,
    onSourceCompositionChange: props.onSourceCompositionChange,
    embeddingDepth: props.depth,
  })
  dataRef.current = {
    workspace: props.workspace,
    databases: props.databases,
    sources: props.sources,
    profile,
    onOpenPage: props.onOpenPage,
    onSourceEdit: props.onSourceEdit,
    onSourceCreate: props.onSourceCreate,
    onSourceCompositionChange: props.onSourceCompositionChange,
    embeddingDepth: props.depth,
  }

  useEffect(() => {
    const target = mount.current
    if (target === null) return
    const initial = propsRef.current.document
    emittedRef.current = JSON.stringify(initial)
    const session = new ModelSession({
      modelId: documentId,
      document: pageDocumentToSnapshot(
        initial,
        propsRef.current.sources.map((record) => record.content),
      ),
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
    const detach = attachBlockInteractions(view, {
      readOnly: false,
      clipboardPolicy: {
        namespace: "block-editor/workspace",
        cut: "remove-after-write",
        paste: () => (propsRef.current.pasteMode === "reference" ? "link" : "clone"),
      },
      onReferencePaste: (envelope, context) => {
        const sourceIds = [...new Set(envelope.externalReferences)]
        const section = context.view.state.schema.nodes["section"]
        if (section === undefined || sourceIds.length === 0) return
        const references = sourceIds.flatMap((sourceId) =>
          propsRef.current.sources.some((record) => record.content.id === sourceId)
            ? [
                section.create({
                  id: crypto.randomUUID(),
                  locked: false,
                  occurrenceId: crypto.randomUUID(),
                  sourceId,
                }),
              ]
            : [],
        )
        if (references.length === 0) return
        context.view.dispatch(
          context.view.state.tr
            .insert(context.insertion, Fragment.fromArray(references))
            .setMeta("origin", "paste")
            .scrollIntoView(),
        )
      },
    })
    const openInternalLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]")
      if (anchor === null || anchor.closest(".ProseMirror") !== view.dom) return
      const target = parseInternalTarget(anchor.getAttribute("href") ?? "")
      if (target === null) return
      event.preventDefault()
      if (target.kind === "page") propsRef.current.onOpenPage(target.pageId)
      else
        propsRef.current.onOpenPage(
          target.pageId ?? propsRef.current.document.pageId,
          target.blockId,
        )
    }
    view.dom.addEventListener("click", openInternalLink)
    sessionRef.current = session
    viewRef.current = view
    workspaceViews.refresh()
    const revealId = decodeURIComponent(
      view.dom.ownerDocument.defaultView?.location.hash.slice(1) ?? "",
    )
    if (revealId.length > 0)
      view.dom.ownerDocument.defaultView?.requestAnimationFrame(() => {
        const revealed = view.dom.querySelector<HTMLElement>(
          `[data-block-id="${CSS.escape(revealId)}"]`,
        )
        revealed?.scrollIntoView({ block: "center" })
        revealed?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
      })
    if (propsRef.current.autoFocus === true) view.focus()
    refreshViewsRef.current = workspaceViews.refresh
    return () => {
      clearTimeout(compositionTimer)
      propsRef.current.onCompositionChange(false)
      unsubscribe()
      detach()
      view.dom.removeEventListener("click", openInternalLink)
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
      document: pageDocumentToSnapshot(
        props.document,
        props.sources.map((record) => record.content),
      ),
    })
    if (result.kind === "applied") view.updateState(session.state)
  }, [props.document, props.sources])

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

import type { Database, PageDocument, SyncedSource, Workspace } from "@slop-lab/blocks-workspace"
import { EditorView } from "prosemirror-view"
import { useEffect, useRef } from "react"
import { parseInternalTarget } from "../../core/links"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { ModelSession } from "../../pm/session"
import { useWorkspaceFocusView } from "./useWorkspaceFocusView"
import type { EntityRecord } from "./workspace-api"
import { pageDocumentToSnapshot, snapshotToPageDocument } from "./workspace-editor-model"
import type { WorkspaceFocusTarget } from "./workspace-focus-navigation"
import {
  focusTargetAfterDocumentChange,
  type WorkspaceFocusChange,
} from "./workspace-focus-selection"
import { workspaceFocusDecorations } from "./workspace-focus-view"
import type { SourceEditRequest, WorkspaceNodeViewData } from "./workspace-node-view-types"
import { createWorkspaceNodeViews } from "./workspace-node-views"
import { pasteWorkspaceReferences } from "./workspace-reference-paste"
import type { WorkspaceSourceRuntime } from "./workspace-source-runtime"

type Props = {
  readonly workspace: Workspace
  readonly document: PageDocument
  readonly depth: number
  readonly databases: readonly Database[]
  readonly sources: readonly EntityRecord<SyncedSource>[]
  readonly onDocument: (document: PageDocument) => void
  readonly onSourceEdit: (request: SourceEditRequest) => void
  readonly onSourceCreate: (source: SyncedSource) => Promise<EntityRecord<SyncedSource> | null>
  readonly onSourceCompositionChange: (sourceId: string, composing: boolean) => void
  readonly onSourceConflictResolve: (
    sourceId: string,
    resolution: "accept-remote" | "keep-local",
  ) => void
  readonly onOpenPage: (id: string, blockId?: string) => void
  readonly onCompositionChange: (composing: boolean) => void
  readonly pasteMode: "clone" | "reference"
  readonly sourceController: WorkspaceSourceRuntime
  readonly autoFocus?: boolean
  readonly focusTarget?: WorkspaceFocusTarget | null
  readonly onOpenBlock: (target: WorkspaceFocusTarget) => void
  readonly onFocusChange?: (change: WorkspaceFocusChange) => void
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
  const profile = props.sourceController.profile
  const dataRef = useRef<WorkspaceNodeViewData>({
    workspace: props.workspace,
    databases: props.databases,
    sources: props.sources,
    profile,
    onOpenPage: props.onOpenPage,
    onOpenBlock: props.onOpenBlock,
    ...(props.onFocusChange === undefined ? {} : { onFocusChange: props.onFocusChange }),
    onSourceEdit: props.onSourceEdit,
    onSourceCreate: props.onSourceCreate,
    onSourceCompositionChange: props.onSourceCompositionChange,
    onSourceConflictResolve: props.onSourceConflictResolve,
    embeddingDepth: props.depth,
    focusTarget: props.focusTarget ?? null,
  })
  dataRef.current = {
    workspace: props.workspace,
    databases: props.databases,
    sources: props.sources,
    profile,
    onOpenPage: props.onOpenPage,
    onOpenBlock: props.onOpenBlock,
    ...(props.onFocusChange === undefined ? {} : { onFocusChange: props.onFocusChange }),
    onSourceEdit: props.onSourceEdit,
    onSourceCreate: props.onSourceCreate,
    onSourceCompositionChange: props.onSourceCompositionChange,
    onSourceConflictResolve: props.onSourceConflictResolve,
    embeddingDepth: props.depth,
    focusTarget: props.focusTarget ?? null,
  }
  useWorkspaceFocusView({
    view: viewRef,
    data: dataRef,
    refreshNodeViews: refreshViewsRef,
    target: props.focusTarget ?? null,
  })

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
    const workspaceViews = createWorkspaceNodeViews(dataRef, propsRef.current.sourceController)
    let compositionTimer: ReturnType<typeof setTimeout> | undefined
    const view = new EditorView(target, {
      state: session.state,
      attributes: {
        class: "editor-content structured-prosemirror",
        "aria-label": "Structured document editor",
      },
      nodeViews: workspaceViews.nodeViews,
      decorations: (state) =>
        workspaceFocusDecorations(state.doc, propsRef.current.focusTarget ?? null),
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
            session.flushExternal()
            propsRef.current.onCompositionChange(false)
          }, 0)
          return false
        },
      },
      dispatchTransaction: (transaction) => {
        session.dispatch(transaction)
        if (!transaction.docChanged || propsRef.current.focusTarget?.kind !== "local") return
        const nextTarget = focusTargetAfterDocumentChange(
          session.state.doc,
          session.state.selection,
          propsRef.current.focusTarget,
        )
        if (nextTarget !== null) propsRef.current.onFocusChange?.(nextTarget)
      },
    })
    const unsubscribe = session.subscribe((event) => {
      view.updateState(session.state)
      if (event === null || event.origin === "host") return
      const document = snapshotToPageDocument(session.snapshot, propsRef.current.document)
      emittedRef.current = JSON.stringify(document)
      propsRef.current.onDocument(document)
    })
    const interactionContext = propsRef.current.sourceController.interactionContext(
      `page:${documentId}`,
    )
    const detach = attachBlockInteractions(view, {
      readOnly: false,
      isActive: interactionContext.isActive,
      claim: interactionContext.claim,
      release: interactionContext.release,
      subscribeActive: interactionContext.subscribe,
      onOpenBlock: (blockId) => {
        interactionContext.release()
        propsRef.current.onOpenBlock({ kind: "local", blockId })
      },
      clipboardPolicy: {
        namespace: "block-editor/workspace",
        cut: "remove-after-write",
        paste: () => (propsRef.current.pasteMode === "reference" ? "link" : "clone"),
      },
      onReferencePaste: (envelope, context) =>
        pasteWorkspaceReferences(envelope, context, propsRef.current.sources),
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

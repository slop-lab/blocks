import type { EditorView } from "prosemirror-view"
import { useCallback, useState } from "react"
import type { RouteId } from "../components/Sidebar"
import { createBindingState, resolveBinding } from "../core/bindings"
import { acceptReview } from "../core/review"
import type { BlockDocument, SurfaceState } from "../core/types"
import {
  type ContentRoute,
  createReviewDocument,
  isContentRoute,
  replaceSessionDocument,
  resetDocument,
} from "./documents"
import { loadNotice } from "./notices"
import {
  createViewData,
  loadHostState,
  type ReleaseForm,
  saveHostState,
  saveReleaseForm,
  toggleTask,
} from "./store"
import { useDocumentSessions } from "./useDocumentSessions"

type ReviewState = {
  readonly route: ContentRoute
  readonly epoch: number
  readonly baseVersion: number
  readonly before: BlockDocument
  readonly candidate: BlockDocument
}

export const useWorkspace = () => {
  const [route, setRoute] = useState<RouteId>(() =>
    new URLSearchParams(window.location.search).get("workspace") === "git-documents"
      ? "git-documents"
      : new URLSearchParams(window.location.search).get("workspace") === "structured-workspace"
        ? "structured-workspace"
        : new URLSearchParams(window.location.search).get("workspace") === "agent-workbench"
          ? "agent-workbench"
          : "note",
  )
  const [toast, setToast] = useState("")
  const documents = useDocumentSessions(setToast)
  const { sessions, engines, update: updateSession } = documents
  const [viewData, setViewData] = useState<Readonly<Record<ContentRoute, SurfaceState>>>(() => ({
    note: createViewData(),
    presentation: createViewData(),
    readonly: createViewData(),
  }))
  const [hostState, setHostState] = useState(() => loadHostState(localStorage))
  const [hostBaseline, setHostBaseline] = useState(() => loadHostState(localStorage))
  const [view, setView] = useState<EditorView | null>(null)
  const [preview, setPreview] = useState(
    () => new URLSearchParams(window.location.search).get("viewer") === "1",
  )
  const [exportOpen, setExportOpen] = useState(false)
  const [hostFormOpen, setHostFormOpen] = useState(false)
  const [review, setReview] = useState<ReviewState | null>(null)

  const contentRoute = isContentRoute(route) ? route : "note"
  const session = sessions[contentRoute]
  const activeViewData = viewData[contentRoute]
  const contentDirty = documents.dirty[contentRoute]
  const hostDirty = JSON.stringify(hostState) !== JSON.stringify(hostBaseline)
  const preserveComposition = () => {
    if (engines.current.get(contentRoute)?.isComposing !== true) return false
    setToast("Finish the current composition first. Your draft is preserved.")
    return true
  }
  const getSession = () => documents.get(contentRoute)

  const onCompositionChange = useCallback(
    (next: boolean) => {
      setViewData((current) => ({
        ...current,
        [contentRoute]: {
          ...current[contentRoute],
          overlays: { ...current[contentRoute].overlays, composing: next },
        },
      }))
      if (!next) {
        documents.afterComposition(contentRoute)
        const result = engines.current.get(contentRoute)?.flushExternal()
        if (result?.kind === "conflict") setToast(`External update conflict · ${result.reason}`)
        if (result?.kind === "applied") setToast("Updated to the latest content")
      }
    },
    [contentRoute, documents, engines],
  )

  const save = () => {
    if (!documents.save(contentRoute)) return
    saveHostState(localStorage, hostState)
    setHostBaseline(hostState)
    setToast("Saved the content and host state in this browser")
  }

  const createReview = () => {
    const engine = getSession()
    const current = engine.snapshot
    setReview({
      route: contentRoute,
      epoch: session.epoch,
      baseVersion: engine.version,
      before: current,
      candidate: createReviewDocument(current),
    })
    setToast("")
  }

  const acceptCandidate = (candidate: BlockDocument) => {
    if (preserveComposition()) return false
    if (review === null) return false
    const current = sessions[review.route]
    if (route !== review.route || current.epoch !== review.epoch) {
      setToast("Review candidate rejected · route or epoch changed")
      return false
    }
    const result = acceptReview(
      { id: "ui-review", baseVersion: review.baseVersion, document: candidate },
      getSession().version,
    )
    if (result.kind === "base_mismatch") {
      setToast(`Review conflict · base v${result.expected}, current v${result.received}`)
      return false
    }
    setView(null)
    updateSession(review.route, (value) => replaceSessionDocument(value, result.document))
    setReview(null)
    setToast("Applied the revision")
    return true
  }

  const reset = () => {
    if (preserveComposition()) return
    setView(null)
    updateSession(contentRoute, (current) =>
      replaceSessionDocument(current, resetDocument(contentRoute)),
    )
    setReview(null)
    setToast("Restored the default document")
  }

  const importDocument = (document: BlockDocument) => {
    if (preserveComposition()) return
    setView(null)
    updateSession(contentRoute, (current) => replaceSessionDocument(current, document))
    setExportOpen(false)
    setToast("Imported the document")
  }

  const saveHostDraft = (draft: Omit<ReleaseForm, "revision">, expectedRevision: number) => {
    const binding = createBindingState([
      {
        blockId: "release-form",
        version: hostState.releaseForm.revision,
        draft: JSON.stringify(hostState.releaseForm),
        dirty: true,
      },
    ])
    const resolution = resolveBinding(
      binding,
      { blockId: "release-form", version: expectedRevision },
      JSON.stringify(draft),
    )
    if (resolution.kind === "stale") return false
    setHostState((current) => saveReleaseForm(current, draft))
    setToast("Saved the briefing details")
    return true
  }

  return {
    route,
    contentRoute,
    session,
    activeViewData,
    hostState,
    view,
    preview,
    toast,
    exportOpen,
    hostFormOpen,
    review,
    contentDirty,
    hostDirty,
    saveMode: documents.modes[contentRoute],
    setSaveMode: (mode: import("./useDocumentSessions").SaveMode) =>
      documents.configure(contentRoute, mode),
    onBlur: () => documents.blur(contentRoute),
    getSession,
    notifyUnavailable: (reason: string) => setToast(reason),
    navigate: (next: RouteId) => {
      if (preserveComposition()) return false
      documents.flush(contentRoute)
      setRoute(next)
      setPreview(false)
      setView(null)
      return true
    },
    togglePreview: () => {
      if (!preserveComposition()) {
        documents.flush(contentRoute)
        setPreview((current) => !current)
      }
    },
    openExport: () => {
      documents.flush(contentRoute)
      setExportOpen(true)
    },
    closeExport: () => setExportOpen(false),
    openHostForm: () => setHostFormOpen(true),
    closeHostForm: () => setHostFormOpen(false),
    rejectReview: () => {
      setReview(null)
      setToast("Discarded the review candidate")
    },
    onReady: (next: EditorView | null) => setView(next),
    onCompositionChange,
    save,
    createReview,
    acceptCandidate,
    reset,
    importDocument,
    saveHostDraft,
    toggleHostTask: (taskId: string) => {
      setHostState((current) => toggleTask(current, taskId))
      setToast(`Changed the status of ${taskId}`)
    },
    selectBlock: (selectedBlockId: string | null) =>
      setViewData((current) =>
        current[contentRoute].ui.selectedBlockId === selectedBlockId
          ? current
          : {
              ...current,
              [contentRoute]: {
                ...current[contentRoute],
                ui: { ...current[contentRoute].ui, selectedBlockId },
              },
            },
      ),
    applyExternal: async () => {
      const engine = getSession()
      const target = { modelId: contentRoute, epoch: engine.epoch, baseVersion: engine.version }
      try {
        const notice = await loadNotice(engine.snapshot)
        const result = engine.applyExternal({ ...target, ...notice })
        if (result.kind === "applied") {
          updateSession(contentRoute, (current) => ({
            ...current,
            document: engine.snapshot,
            version: engine.version,
          }))
          setToast(
            "Updated the guide. Previous undo history remains separate from the new content.",
          )
        } else if (result.kind === "deferred")
          setToast("External update deferred until IME composition ends")
        else setToast(`External update conflict · ${result.reason}`)
      } catch (error) {
        setToast(
          error instanceof Error
            ? `Could not fetch the guide: ${error.message}`
            : "Could not fetch the guide",
        )
      }
    },
  }
}

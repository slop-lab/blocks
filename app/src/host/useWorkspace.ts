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
  const [route, setRoute] = useState<RouteId>("note")
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
    setToast("조합 중인 입력을 먼저 확정해 주세요. 초안은 유지됩니다.")
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
        if (result?.kind === "conflict") setToast(`외부 업데이트 충돌 · ${result.reason}`)
        if (result?.kind === "applied") setToast("최신 내용으로 갱신했습니다")
      }
    },
    [contentRoute, documents, engines],
  )

  const save = () => {
    if (!documents.save(contentRoute)) return
    saveHostState(localStorage, hostState)
    setHostBaseline(hostState)
    setToast("콘텐츠와 호스트 상태를 브라우저에 저장했습니다")
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
      setToast("검토 후보 거절 · route 또는 epoch가 변경되었습니다")
      return false
    }
    const result = acceptReview(
      { id: "ui-review", baseVersion: review.baseVersion, document: candidate },
      getSession().version,
    )
    if (result.kind === "base_mismatch") {
      setToast(`검토 충돌 · 기준 v${result.expected}, 현재 v${result.received}`)
      return false
    }
    setView(null)
    updateSession(review.route, (value) => replaceSessionDocument(value, result.document))
    setReview(null)
    setToast("수정안을 적용했습니다")
    return true
  }

  const reset = () => {
    if (preserveComposition()) return
    setView(null)
    updateSession(contentRoute, (current) =>
      replaceSessionDocument(current, resetDocument(contentRoute)),
    )
    setReview(null)
    setToast("기본 문서로 되돌렸습니다")
  }

  const importDocument = (document: BlockDocument) => {
    if (preserveComposition()) return
    setView(null)
    updateSession(contentRoute, (current) => replaceSessionDocument(current, document))
    setExportOpen(false)
    setToast("문서를 가져왔습니다")
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
    setToast("브리핑 정보를 저장했습니다")
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
      setToast("검토 후보를 폐기했습니다")
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
      setToast(`${taskId} 상태를 변경했습니다`)
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
          setToast("안내를 갱신했습니다. 이전 실행 취소 기록은 새 내용과 분리했습니다.")
        } else if (result.kind === "deferred") setToast("IME 조합이 끝날 때까지 외부 업데이트 보류")
        else setToast(`외부 업데이트 충돌 · ${result.reason}`)
      } catch (error) {
        setToast(
          error instanceof Error
            ? `안내를 가져오지 못했습니다: ${error.message}`
            : "안내를 가져오지 못했습니다",
        )
      }
    },
  }
}

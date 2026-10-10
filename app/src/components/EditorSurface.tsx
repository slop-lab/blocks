import type { EditorView as EditorViewType, NodeView } from "prosemirror-view"
import { EditorView } from "prosemirror-view"
import { useEffect, useRef } from "react"
import type { BlockDocument, ChangeEvent } from "../core/types"
import type { HostTask } from "../host/store"
import { attachBlockInteractions } from "../pm/block-interactions"
import { ModelSession } from "../pm/session"

type EditorSurfaceProps = {
  readonly document: BlockDocument
  readonly readOnly: boolean
  readonly epoch: number
  readonly version: number
  readonly tasks: Readonly<Record<string, HostTask>>
  readonly onReady: (view: EditorViewType | null) => void
  readonly onChange?: (document: BlockDocument, event: ChangeEvent) => void
  readonly onHostAction: (taskId: string) => void
  readonly onSelectionChange: (blockId: string | null) => void
  readonly onCompositionChange: (composing: boolean) => void
  readonly getSession?: () => ModelSession
  readonly onUnavailable?: (reason: string) => void
  readonly onBlur?: () => void
}

const taskNodeView =
  (
    tasksRef: { readonly current: Readonly<Record<string, HostTask>> },
    actionRef: { readonly current: (taskId: string) => void },
    views: Set<() => void>,
  ) =>
  (
    node: Parameters<
      NonNullable<ConstructorParameters<typeof EditorView>[1]["nodeViews"]>[string]
    >[0],
  ): NodeView => {
    const dom = document.createElement("article")
    dom.className = "task-card"
    dom.dataset["blockId"] = String(node.attrs["id"])
    dom.dataset["locked"] = String(node.attrs["locked"] === true)
    const meta = document.createElement("span")
    meta.className = "task-card__meta"
    const taskId = String(node.attrs["taskId"])
    const title = document.createElement("strong")
    const button = document.createElement("button")
    button.type = "button"
    button.className = "button button--secondary"
    const render = () => {
      const task = tasksRef.current[taskId]
      meta.textContent = `${taskId} · ${task?.status ?? "unavailable"}`
      title.textContent = task?.title ?? "호스트 데이터 없음"
      button.textContent = task?.status === "done" ? "다시 열기" : "완료로 표시"
      button.disabled = task === undefined
    }
    button.addEventListener("click", () => actionRef.current(taskId))
    dom.append(meta, title, button)
    views.add(render)
    render()
    return {
      dom,
      stopEvent: (event) => event.target instanceof Node && button.contains(event.target),
      destroy: () => {
        views.delete(render)
      },
    }
  }

export const EditorSurface = ({
  document: snapshot,
  readOnly,
  epoch,
  version,
  tasks,
  onReady,
  onChange,
  onHostAction,
  onSelectionChange,
  onCompositionChange,
  getSession,
  onUnavailable,
  onBlur,
}: EditorSurfaceProps) => {
  const mountRef = useRef<HTMLDivElement>(null)
  const initialSnapshotRef = useRef(snapshot)
  const initialVersionRef = useRef(version)
  const tasksRef = useRef(tasks)
  const actionRef = useRef(onHostAction)
  const changeRef = useRef(onChange)
  const readyRef = useRef(onReady)
  const selectionRef = useRef(onSelectionChange)
  const compositionRef = useRef(onCompositionChange)
  const taskViewsRef = useRef(new Set<() => void>())
  const sessionProviderRef = useRef(getSession)
  const unavailableRef = useRef(onUnavailable)
  const blurRef = useRef(onBlur)
  blurRef.current = onBlur
  unavailableRef.current = onUnavailable
  tasksRef.current = tasks
  actionRef.current = onHostAction
  changeRef.current = onChange
  readyRef.current = onReady
  selectionRef.current = onSelectionChange
  compositionRef.current = onCompositionChange

  const taskRevision = JSON.stringify(tasks)
  useEffect(() => {
    void taskRevision
    for (const render of taskViewsRef.current.values()) render()
  }, [taskRevision])

  useEffect(() => {
    const mount = mountRef.current
    if (mount === null) return
    const session =
      sessionProviderRef.current?.() ??
      new ModelSession({
        modelId: crypto.randomUUID(),
        document: initialSnapshotRef.current,
        epoch,
        version: initialVersionRef.current,
        readOnly,
      })
    const release = session.attach()
    if (release === null) throw new Error("This session already has an editing surface")
    let compositionTimer: ReturnType<typeof setTimeout> | undefined
    const view = new EditorView(mount, {
      state: session.state,
      editable: () => !readOnly,
      attributes: {
        class: "editor-content",
        "aria-label": readOnly ? "읽기 전용 문서" : "블록 문서 편집기",
      },
      nodeViews: { task_card: taskNodeView(tasksRef, actionRef, taskViewsRef.current) },
      handleDOMEvents: {
        blur: () => {
          blurRef.current?.()
          return false
        },
        compositionstart: () => {
          clearTimeout(compositionTimer)
          session.setComposing(true)
          compositionRef.current(true)
          return false
        },
        compositionend: () => {
          clearTimeout(compositionTimer)
          compositionTimer = setTimeout(() => {
            session.setComposing(false)
            compositionRef.current(false)
          }, 0)
          return false
        },
      },
      dispatchTransaction(transaction) {
        const applied = session.dispatch(transaction)
        if (!applied && transaction.docChanged)
          unavailableRef.current?.("읽기 전용 또는 잠긴 블록을 포함한 변경을 전체 거절했습니다.")
        const anchor = session.state.selection.$from
        const selected = anchor.depth > 0 ? anchor.node(1) : (anchor.nodeAfter ?? anchor.nodeBefore)
        selectionRef.current(
          typeof selected?.attrs["id"] === "string" ? selected.attrs["id"] : null,
        )
      },
    })
    const unsubscribe = session.subscribe((event) => {
      view.updateState(session.state)
      if (event !== null && sessionProviderRef.current === undefined)
        changeRef.current?.(session.snapshot, event)
    })
    const detachInteractions = attachBlockInteractions(view, {
      readOnly,
      onUnavailable: (message) => unavailableRef.current?.(message),
    })
    readyRef.current(view)
    return () => {
      clearTimeout(compositionTimer)
      session.setComposing(false)
      unsubscribe()
      release()
      if (sessionProviderRef.current === undefined) session.dispose()
      readyRef.current(null)
      taskViewsRef.current.clear()
      detachInteractions()
      view.destroy()
    }
  }, [epoch, readOnly])

  return <div className={readOnly ? "editor editor--readonly" : "editor"} ref={mountRef} />
}

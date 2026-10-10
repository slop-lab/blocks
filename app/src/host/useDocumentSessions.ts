import { useEffect, useRef, useState } from "react"
import { ChangeDelivery } from "../core/change-delivery"
import { ModelSession } from "../pm/session"
import type { ContentRoute, WorkspaceSession } from "./documents"
import type { SaveMode } from "./save-modes"
import { loadSaveModes, saveModesKey } from "./save-modes"

export type { SaveMode } from "./save-modes"

import { loadWorkspaceSessions, persistDocument } from "./documents"

export const useDocumentSessions = (notify: (message: string) => void) => {
  const [sessions, setSessions] = useState(() => loadWorkspaceSessions(localStorage))
  const stateRef = useRef(sessions)
  stateRef.current = sessions
  const [modes, setModes] = useState(() => loadSaveModes(localStorage))
  const modesRef = useRef(modes)
  modesRef.current = modes
  const [dirty, setDirty] = useState<Readonly<Record<ContentRoute, boolean>>>({
    note: false,
    presentation: false,
    readonly: false,
  })
  const dirtyRef = useRef(dirty)
  const engines = useRef(new Map<ContentRoute, ModelSession>())
  const deliveries = useRef(new Map<ContentRoute, ChangeDelivery>())
  const pendingBlur = useRef(new Set<ContentRoute>())
  const lifetime = useRef(0)

  const markDirty = (route: ContentRoute, value: boolean) => {
    if (dirtyRef.current[route] === value) return
    dirtyRef.current = { ...dirtyRef.current, [route]: value }
    setDirty(dirtyRef.current)
  }
  const update = (
    route: ContentRoute,
    transform: (current: WorkspaceSession) => WorkspaceSession,
  ) => {
    const next = { ...stateRef.current, [route]: transform(stateRef.current[route]) }
    stateRef.current = next
    setSessions(next)
    markDirty(route, JSON.stringify(next[route].document) !== JSON.stringify(next[route].baseline))
  }
  const save = (route: ContentRoute) => {
    const engine = engines.current.get(route)
    if (engine?.isComposing) return false
    const current = stateRef.current[route]
    const document = engine?.epoch === current.epoch ? engine.snapshot : current.document
    try {
      persistDocument(localStorage, route, document)
      update(route, (value) => ({
        ...value,
        document,
        baseline: document,
        version: engine?.version ?? value.version,
      }))
      markDirty(route, false)
      notify("이 브라우저에 저장했습니다")
      return true
    } catch (error) {
      notify(
        error instanceof Error
          ? `저장 실패: ${error.message}`
          : "저장하지 못했습니다. 초안은 유지됩니다.",
      )
      return false
    }
  }
  const get = (route: ContentRoute) => {
    const state = stateRef.current[route]
    const existing = engines.current.get(route)
    if (existing?.epoch === state.epoch) return existing
    existing?.dispose()
    deliveries.current.get(route)?.dispose()
    const engine = new ModelSession({
      modelId: route,
      document: state.document,
      epoch: state.epoch,
      version: state.version,
      readOnly: route === "readonly",
    })
    const policy = (mode: SaveMode) =>
      mode === "throttle"
        ? { mode: "throttle" as const, interval: 1000 }
        : { mode: "debounce" as const, delay: 600, maxWait: 3000 }
    const delivery = new ChangeDelivery((batch) => {
      if (stateRef.current[route].epoch !== engine.epoch) return
      if (engine.isComposing) return
      const document = engine.snapshot
      update(route, (current) =>
        current.epoch === engine.epoch
          ? { ...current, document, version: engine.version }
          : current,
      )
      markDirty(
        route,
        JSON.stringify(document) !== JSON.stringify(stateRef.current[route].baseline),
      )
      if (
        dirtyRef.current[route] &&
        batch.origins.some((origin) => origin === "local" || origin === "history") &&
        (modesRef.current[route] === "debounce" || modesRef.current[route] === "throttle")
      )
        save(route)
    }, policy(modesRef.current[route]))
    engine.subscribe((event) => {
      if (event === null || stateRef.current[route].epoch !== engine.epoch) return
      markDirty(route, true)
      delivery.push(event)
      if (event.origin === "host") delivery.flush()
    })
    deliveries.current.set(route, delivery)
    engines.current.set(route, engine)
    return engine
  }
  const flush = (route: ContentRoute) => {
    deliveries.current.get(route)?.flush()
    const engine = engines.current.get(route)
    if (engine !== undefined && engine.epoch === stateRef.current[route].epoch)
      update(route, (current) => ({
        ...current,
        document: engine.snapshot,
        version: engine.version,
      }))
  }
  const configure = (route: ContentRoute, mode: SaveMode) => {
    modesRef.current = { ...modesRef.current, [route]: mode }
    setModes(modesRef.current)
    try {
      localStorage.setItem(saveModesKey, JSON.stringify(modesRef.current))
    } catch (error) {
      notify(
        error instanceof Error
          ? `저장 설정을 보관하지 못했습니다: ${error.message}`
          : "저장 설정을 보관하지 못했습니다",
      )
    }
    deliveries.current
      .get(route)
      ?.configure(
        mode === "throttle"
          ? { mode: "throttle", interval: 1000 }
          : { mode: "debounce", delay: 600, maxWait: 3000 },
      )
    if (dirtyRef.current[route] && (mode === "debounce" || mode === "throttle")) save(route)
  }
  useEffect(() => {
    const generation = ++lifetime.current
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.values(dirtyRef.current).some(Boolean)) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => {
      window.removeEventListener("beforeunload", warn)
      queueMicrotask(() => {
        if (lifetime.current !== generation) return
        for (const delivery of deliveries.current.values()) delivery.dispose()
        for (const engine of engines.current.values()) engine.dispose()
      })
    }
  }, [])
  return {
    sessions,
    engines,
    get,
    update,
    save,
    flush,
    dirty,
    modes,
    configure,
    blur: (route: ContentRoute) => {
      if (modesRef.current[route] !== "blur" || !dirtyRef.current[route]) return
      if (engines.current.get(route)?.isComposing) pendingBlur.current.add(route)
      else save(route)
    },
    afterComposition: (route: ContentRoute) => {
      flush(route)
      const blurRequested = pendingBlur.current.delete(route)
      if (
        dirtyRef.current[route] &&
        (modesRef.current[route] === "debounce" ||
          modesRef.current[route] === "throttle" ||
          (modesRef.current[route] === "blur" && blurRequested))
      )
        save(route)
    },
  }
}

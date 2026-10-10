import { z } from "zod"
import type { CompositeSnapshot } from "./profile"

const compositeSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  document: z.record(z.string(), z.unknown()),
  code: z.string(),
})

const persistedWorkspaceSchema = z.object({
  schemaVersion: z.literal(1),
  saved: compositeSnapshotSchema,
  draft: compositeSnapshotSchema,
})

export type PersistedCompositeWorkspace = {
  readonly schemaVersion: 1
  readonly saved: CompositeSnapshot
  readonly draft: CompositeSnapshot
}

export const COMPOSITE_STORAGE_KEY = "slate-foundation/composite-workspace/v1"

export const loadCompositeWorkspace = (storage: Storage): PersistedCompositeWorkspace | null => {
  const serialized = storage.getItem(COMPOSITE_STORAGE_KEY)
  if (serialized === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(serialized)
  } catch (caught) {
    if (caught instanceof SyntaxError) return null
    throw caught
  }
  const parsed = persistedWorkspaceSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const writeWorkspace = (storage: Storage, workspace: PersistedCompositeWorkspace): void => {
  storage.setItem(COMPOSITE_STORAGE_KEY, JSON.stringify(workspace))
}

export const saveCompositeWorkspace = (storage: Storage, snapshot: CompositeSnapshot): void => {
  writeWorkspace(storage, { schemaVersion: 1, saved: snapshot, draft: snapshot })
}

export const saveCompositeDraft = (storage: Storage, snapshot: CompositeSnapshot): void => {
  const current = loadCompositeWorkspace(storage)
  writeWorkspace(storage, {
    schemaVersion: 1,
    saved: current?.saved ?? snapshot,
    draft: snapshot,
  })
}

export const initializeCompositeWorkspace = (
  storage: Storage,
  fallback: CompositeSnapshot,
): PersistedCompositeWorkspace => {
  const current = loadCompositeWorkspace(storage)
  if (current !== null) return current
  const initialized = { schemaVersion: 1, saved: fallback, draft: fallback } as const
  writeWorkspace(storage, initialized)
  return initialized
}

export type CompositeDraftWriter = {
  readonly schedule: (snapshot: () => CompositeSnapshot) => void
  readonly flush: () => void
  readonly commit: (snapshot: CompositeSnapshot) => void
  readonly cancel: () => void
}

export type CompositeDraftTiming = {
  readonly delay: number
  readonly maxWait: number
}

const defaultDraftTiming: CompositeDraftTiming = { delay: 600, maxWait: 3_000 }

export const createCompositeDraftWriter = (
  storage: Storage,
  timing: CompositeDraftTiming = defaultDraftTiming,
): CompositeDraftWriter => {
  let pending: (() => CompositeSnapshot) | null = null
  let delayTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimers = () => {
    if (delayTimer !== null) clearTimeout(delayTimer)
    if (maxTimer !== null) clearTimeout(maxTimer)
    delayTimer = null
    maxTimer = null
  }
  const flush = () => {
    const readSnapshot = pending
    if (readSnapshot === null) return
    pending = null
    clearTimers()
    saveCompositeDraft(storage, readSnapshot())
  }
  const cancel = () => {
    pending = null
    clearTimers()
  }

  return {
    schedule: (snapshot) => {
      pending = snapshot
      if (delayTimer !== null) clearTimeout(delayTimer)
      delayTimer = setTimeout(flush, timing.delay)
      maxTimer ??= setTimeout(flush, timing.maxWait)
    },
    flush,
    commit: (snapshot) => {
      cancel()
      saveCompositeWorkspace(storage, snapshot)
    },
    cancel,
  }
}

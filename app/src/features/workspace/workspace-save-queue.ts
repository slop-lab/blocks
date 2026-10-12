import type { EntityRecord, WorkspacePayload } from "./workspace-api"

export type WorkspaceEntityKind = "trees" | "pages" | "databases" | "sources"
export type SaveTarget = { readonly kind: WorkspaceEntityKind; readonly id: string }
export type QueueRecord = EntityRecord<unknown>
export type SaveCausality = {
  readonly generation: number
  readonly causeId: string
  readonly baselineRevision: number
}
export type SaveRequest = {
  readonly target: SaveTarget
  readonly baseline: QueueRecord
  readonly content: unknown
  readonly causality?: SaveCausality
}
export type SaveSettlement = {
  readonly target: SaveTarget
  readonly saved: QueueRecord
  readonly content: unknown
  readonly clean: boolean
  readonly causality?: SaveCausality
}

type QueueEntry = {
  readonly target: SaveTarget
  baseline: QueueRecord
  content: unknown
  causality: SaveCausality | undefined
  generation: number
  timer: ReturnType<typeof setTimeout> | undefined
  saving: Promise<void> | undefined
  paused: boolean
}

const targetKey = ({ kind, id }: SaveTarget): string => `${kind}:${id}`

export class WorkspaceSaveQueue {
  private readonly entries = new Map<string, QueueEntry>()
  private readonly composingTargets = new Set<string>()
  private disposed = false

  constructor(
    private readonly save: (request: SaveRequest) => Promise<QueueRecord>,
    private readonly onSettled: (settlement: SaveSettlement) => void,
    private readonly onError: (request: SaveRequest, error: unknown) => unknown,
    private readonly delay = 600,
  ) {}

  stage(
    target: SaveTarget,
    baseline: QueueRecord,
    content: unknown,
    causality?: SaveCausality,
  ): void {
    const key = targetKey(target)
    const current = this.entries.get(key)
    if (current === undefined) {
      const entry: QueueEntry = {
        target,
        baseline,
        content,
        causality,
        generation: 1,
        timer: undefined,
        saving: undefined,
        paused: false,
      }
      this.entries.set(key, entry)
      this.schedule(entry, this.delay)
      return
    }
    current.content = content
    current.causality = causality
    current.generation += 1
    if (current.saving === undefined) this.schedule(current, this.delay)
  }

  isDirty(target: SaveTarget): boolean {
    return this.entries.has(targetKey(target))
  }

  setComposing(target: SaveTarget, composing: boolean): void {
    const key = targetKey(target)
    if (composing) this.composingTargets.add(key)
    else this.composingTargets.delete(key)
    if (!composing) {
      const entry = this.entries.get(key)
      if (entry !== undefined && entry.saving === undefined) this.schedule(entry, this.delay)
    }
  }

  retry(): void {
    for (const entry of this.entries.values())
      if (entry.saving === undefined && !entry.paused) this.schedule(entry, this.delay)
  }

  rebase(target: SaveTarget, baseline: QueueRecord, causality?: SaveCausality): void {
    const entry = this.entries.get(targetKey(target))
    if (entry === undefined) return
    entry.baseline = baseline
    entry.causality = causality
    entry.paused = false
    if (entry.saving === undefined) this.schedule(entry, 0)
  }

  discard(target: SaveTarget): void {
    const key = targetKey(target)
    const entry = this.entries.get(key)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    this.entries.delete(key)
  }

  async flush(target: SaveTarget): Promise<void> {
    const entry = this.entries.get(targetKey(target))
    if (entry === undefined) return
    if (entry.saving !== undefined) return entry.saving
    if (this.composingTargets.has(targetKey(target)) || this.disposed || entry.paused) return
    clearTimeout(entry.timer)
    entry.timer = undefined
    const submittedGeneration = entry.generation
    const submittedContent = entry.content
    const submittedCausality = entry.causality
    const request: SaveRequest = {
      target: entry.target,
      baseline: entry.baseline,
      content: submittedContent,
      ...(submittedCausality === undefined ? {} : { causality: submittedCausality }),
    }
    let followup = false
    entry.saving = this.save(request)
      .then((saved) => {
        if (this.disposed) return
        const clean = entry.generation === submittedGeneration
        followup = !clean
        entry.baseline = saved
        if (entry.causality !== undefined)
          entry.causality = { ...entry.causality, baselineRevision: saved.revision }
        this.onSettled({
          target: entry.target,
          saved,
          content: submittedContent,
          clean,
          ...(submittedCausality === undefined ? {} : { causality: submittedCausality }),
        })
        if (clean) this.entries.delete(targetKey(entry.target))
      })
      .catch((error: unknown) => {
        if (!this.disposed && this.onError(request, error) === "pause") entry.paused = true
      })
      .finally(() => {
        entry.saving = undefined
        if (
          followup &&
          !this.disposed &&
          this.entries.has(targetKey(entry.target)) &&
          !this.composingTargets.has(targetKey(entry.target)) &&
          !entry.paused
        )
          this.schedule(entry, 0)
      })
    return entry.saving
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.entries.values()) clearTimeout(entry.timer)
    this.entries.clear()
  }

  resume(): void {
    this.disposed = false
  }

  private schedule(entry: QueueEntry, delay: number): void {
    clearTimeout(entry.timer)
    if (this.composingTargets.has(targetKey(entry.target)) || this.disposed || entry.paused) {
      entry.timer = undefined
      return
    }
    entry.timer = setTimeout(() => void this.flush(entry.target), delay)
  }
}

const mergeRecords = <T>(
  kind: WorkspaceEntityKind,
  current: readonly EntityRecord<T>[],
  remote: readonly EntityRecord<T>[],
  isDirty: (target: SaveTarget) => boolean,
): readonly EntityRecord<T>[] =>
  remote.map((remoteRecord) => {
    const currentRecord = current.find((record) => record.documentId === remoteRecord.documentId)
    if (currentRecord === undefined) return remoteRecord
    if (isDirty({ kind, id: remoteRecord.documentId })) return currentRecord
    return remoteRecord.revision > currentRecord.revision ? remoteRecord : currentRecord
  })

export const mergeWorkspacePayload = (
  current: WorkspacePayload,
  remote: WorkspacePayload,
  isDirty: (target: SaveTarget) => boolean,
): WorkspacePayload => ({
  tree:
    isDirty({ kind: "trees", id: current.tree.documentId }) ||
    current.tree.revision >= remote.tree.revision
      ? current.tree
      : remote.tree,
  documents: mergeRecords("pages", current.documents, remote.documents, isDirty),
  databases: mergeRecords("databases", current.databases, remote.databases, isDirty),
  sources: mergeRecords("sources", current.sources, remote.sources, isDirty),
})

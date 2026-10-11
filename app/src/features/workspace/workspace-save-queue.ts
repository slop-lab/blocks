import type { EntityRecord, WorkspacePayload } from "./workspace-api"

export type WorkspaceEntityKind = "trees" | "pages" | "databases" | "sources"
export type SaveTarget = { readonly kind: WorkspaceEntityKind; readonly id: string }
export type QueueRecord = EntityRecord<unknown>
export type SaveRequest = {
  readonly target: SaveTarget
  readonly baseline: QueueRecord
  readonly content: unknown
}
export type SaveSettlement = {
  readonly target: SaveTarget
  readonly saved: QueueRecord
  readonly content: unknown
  readonly clean: boolean
}

type QueueEntry = {
  readonly target: SaveTarget
  baseline: QueueRecord
  content: unknown
  generation: number
  timer: ReturnType<typeof setTimeout> | undefined
  saving: Promise<void> | undefined
}

const targetKey = ({ kind, id }: SaveTarget): string => `${kind}:${id}`

export class WorkspaceSaveQueue {
  private readonly entries = new Map<string, QueueEntry>()
  private composing = false
  private disposed = false

  constructor(
    private readonly save: (request: SaveRequest) => Promise<QueueRecord>,
    private readonly onSettled: (settlement: SaveSettlement) => void,
    private readonly onError: (target: SaveTarget, error: unknown) => void,
    private readonly delay = 600,
  ) {}

  stage(target: SaveTarget, baseline: QueueRecord, content: unknown): void {
    const key = targetKey(target)
    const current = this.entries.get(key)
    if (current === undefined) {
      const entry: QueueEntry = {
        target,
        baseline,
        content,
        generation: 1,
        timer: undefined,
        saving: undefined,
      }
      this.entries.set(key, entry)
      this.schedule(entry, this.delay)
      return
    }
    current.content = content
    current.generation += 1
    if (current.saving === undefined) this.schedule(current, this.delay)
  }

  isDirty(target: SaveTarget): boolean {
    return this.entries.has(targetKey(target))
  }

  setComposing(composing: boolean): void {
    if (this.composing === composing) return
    this.composing = composing
    if (!composing) this.retry()
  }

  retry(): void {
    for (const entry of this.entries.values())
      if (entry.saving === undefined) this.schedule(entry, this.delay)
  }

  async flush(target: SaveTarget): Promise<void> {
    const entry = this.entries.get(targetKey(target))
    if (entry === undefined) return
    if (entry.saving !== undefined) return entry.saving
    if (this.composing || this.disposed) return
    clearTimeout(entry.timer)
    entry.timer = undefined
    const submittedGeneration = entry.generation
    const submittedContent = entry.content
    let followup = false
    entry.saving = this.save({
      target: entry.target,
      baseline: entry.baseline,
      content: submittedContent,
    })
      .then((saved) => {
        if (this.disposed) return
        const clean = entry.generation === submittedGeneration
        followup = !clean
        entry.baseline = saved
        this.onSettled({
          target: entry.target,
          saved,
          content: submittedContent,
          clean,
        })
        if (clean) this.entries.delete(targetKey(entry.target))
      })
      .catch((error: unknown) => {
        if (!this.disposed) this.onError(entry.target, error)
      })
      .finally(() => {
        entry.saving = undefined
        if (
          followup &&
          !this.disposed &&
          this.entries.has(targetKey(entry.target)) &&
          !this.composing
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

  private schedule(entry: QueueEntry, delay: number): void {
    clearTimeout(entry.timer)
    if (this.composing || this.disposed) {
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
  remote.map((remoteRecord) =>
    isDirty({ kind, id: remoteRecord.documentId })
      ? (current.find((record) => record.documentId === remoteRecord.documentId) ?? remoteRecord)
      : remoteRecord,
  )

export const mergeWorkspacePayload = (
  current: WorkspacePayload,
  remote: WorkspacePayload,
  isDirty: (target: SaveTarget) => boolean,
): WorkspacePayload => ({
  tree: isDirty({ kind: "trees", id: current.tree.documentId }) ? current.tree : remote.tree,
  documents: mergeRecords("pages", current.documents, remote.documents, isDirty),
  databases: mergeRecords("databases", current.databases, remote.databases, isDirty),
  sources: mergeRecords("sources", current.sources, remote.sources, isDirty),
})

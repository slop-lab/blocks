export type SourceRuntimeAdapter<State, Content> = {
  readonly contentOf: (state: State) => Content
  readonly replaceContent: (state: State, content: Content) => State
}

export type SourceRecord<Content> = {
  readonly content: Content
  readonly revision: number
}

export type SourceRuntimeSeed<State> = {
  readonly state: State
  readonly revision: number
}

export type PendingSourceSave<Content> = {
  readonly sourceId: string
  readonly generation: number
  readonly baselineRevision: number
  readonly causeId: string
  readonly content: Content
}

export type SourceAcknowledgement<Content> = {
  readonly generation: number
  readonly causeId: string
  readonly record: SourceRecord<Content>
}

export type RemoteSourceResult =
  | { readonly kind: "applied" }
  | { readonly kind: "ignored" }
  | { readonly kind: "conflict"; readonly remoteRevision: number }

export class SourceAttachmentError extends Error {
  readonly name = "SourceAttachmentError"

  constructor(readonly occurrenceId: string) {
    super(`source occurrence is not attached: ${occurrenceId}`)
  }
}

export class SourceRuntime<State, Content> {
  private currentState: State
  private revision: number
  private generation = 0
  private savedGeneration = 0
  private causeId = ""
  private activeId: string | null = null
  private composing = false
  private readonly occurrences = new Set<string>()
  private readonly listeners = new Set<(state: State) => void>()
  private conflictRecord: SourceRecord<Content> | null = null

  constructor(
    readonly sourceId: string,
    seed: SourceRuntimeSeed<State>,
    private readonly adapter: SourceRuntimeAdapter<State, Content>,
  ) {
    this.currentState = seed.state
    this.revision = seed.revision
  }

  get state(): State {
    return this.currentState
  }

  get baselineRevision(): number {
    return this.revision
  }

  get activeOccurrenceId(): string | null {
    return this.activeId
  }

  get conflict(): SourceRecord<Content> | null {
    return this.conflictRecord
  }

  get dirty(): boolean {
    return this.generation !== this.savedGeneration
  }

  attach(occurrenceId: string): () => void {
    this.occurrences.add(occurrenceId)
    return () => {
      this.occurrences.delete(occurrenceId)
      if (this.activeId === occurrenceId) this.activeId = null
    }
  }

  activate(occurrenceId: string): void {
    if (!this.occurrences.has(occurrenceId)) throw new SourceAttachmentError(occurrenceId)
    this.activeId = occurrenceId
  }

  deactivate(occurrenceId: string): void {
    if (this.activeId === occurrenceId) this.activeId = null
  }

  setComposing(active: boolean): void {
    this.composing = active
  }

  updateLocal(occurrenceId: string, state: State, causeId: string): void {
    if (this.activeId !== occurrenceId) throw new SourceAttachmentError(occurrenceId)
    this.currentState = state
    this.generation += 1
    this.causeId = causeId
    this.emit()
  }

  updateState(occurrenceId: string, state: State): void {
    if (this.activeId !== occurrenceId) throw new SourceAttachmentError(occurrenceId)
    this.currentState = state
    this.emit()
  }

  receiveRemote(record: SourceRecord<Content>): RemoteSourceResult {
    if (record.revision <= this.revision) return { kind: "ignored" }
    if (this.dirty || this.composing) {
      this.conflictRecord = record
      return { kind: "conflict", remoteRevision: record.revision }
    }
    this.currentState = this.adapter.replaceContent(this.currentState, record.content)
    this.revision = record.revision
    this.conflictRecord = null
    this.emit()
    return { kind: "applied" }
  }

  pendingSave(): PendingSourceSave<Content> | null {
    return this.dirty
      ? {
          sourceId: this.sourceId,
          generation: this.generation,
          baselineRevision: this.revision,
          causeId: this.causeId,
          content: this.adapter.contentOf(this.currentState),
        }
      : null
  }

  acknowledge(input: SourceAcknowledgement<Content>): { readonly kind: "accepted" | "stale" } {
    if (input.generation !== this.generation || input.causeId !== this.causeId)
      return { kind: "stale" }
    this.revision = input.record.revision
    this.savedGeneration = input.generation
    this.conflictRecord = null
    return { kind: "accepted" }
  }

  subscribe(listener: (state: State) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.currentState)
  }
}

export class SourceRuntimeRegistry<State, Content> {
  private readonly runtimes = new Map<string, SourceRuntime<State, Content>>()

  constructor(private readonly adapter: SourceRuntimeAdapter<State, Content>) {}

  open(sourceId: string, seed: SourceRuntimeSeed<State>): SourceRuntime<State, Content> {
    const existing = this.runtimes.get(sourceId)
    if (existing !== undefined) return existing
    const runtime = new SourceRuntime(sourceId, seed, this.adapter)
    this.runtimes.set(sourceId, runtime)
    return runtime
  }

  get(sourceId: string): SourceRuntime<State, Content> | null {
    return this.runtimes.get(sourceId) ?? null
  }

  clear(): void {
    this.runtimes.clear()
  }
}

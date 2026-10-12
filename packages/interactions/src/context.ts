export type InteractionContextSnapshot = {
  readonly activeId: string | null
  readonly epoch: number
}

export type InteractionContextHandle = {
  readonly isActive: () => boolean
  readonly claim: () => void
  readonly release: () => void
  readonly subscribe: (listener: (active: boolean) => void) => () => void
}

export class InteractionContextArbiter {
  private activeId: string | null = null
  private epoch = 0
  private readonly listeners = new Set<() => void>()

  get snapshot(): InteractionContextSnapshot {
    return { activeId: this.activeId, epoch: this.epoch }
  }

  context(id: string): InteractionContextHandle {
    return {
      isActive: () => this.activeId === id,
      claim: () => this.claim(id),
      release: () => {
        if (this.activeId === id) this.clear()
      },
      subscribe: (listener) => {
        const notify = () => listener(this.activeId === id)
        this.listeners.add(notify)
        return () => this.listeners.delete(notify)
      },
    }
  }

  clear(): void {
    if (this.activeId === null) return
    this.activeId = null
    this.epoch += 1
    this.emit()
  }

  subscribe(listener: (snapshot: InteractionContextSnapshot) => void): () => void {
    const notify = () => listener(this.snapshot)
    this.listeners.add(notify)
    return () => this.listeners.delete(notify)
  }

  private claim(id: string): void {
    if (this.activeId === id) return
    this.activeId = id
    this.epoch += 1
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

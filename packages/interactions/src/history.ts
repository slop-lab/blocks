export type HistorySnapshot<TContent, TSelection> = {
  readonly content: TContent
  readonly selection: TSelection
}

export class ContentHistory<TContent, TSelection> {
  private readonly past: HistorySnapshot<TContent, TSelection>[] = []
  private readonly future: HistorySnapshot<TContent, TSelection>[] = []
  private current: HistorySnapshot<TContent, TSelection>

  constructor(initial: HistorySnapshot<TContent, TSelection>) {
    this.current = initial
  }

  record(next: HistorySnapshot<TContent, TSelection>, contentChanged: boolean): void {
    if (contentChanged) {
      this.past.push(this.current)
      this.future.length = 0
    }
    this.current = next
  }

  undo(): HistorySnapshot<TContent, TSelection> | null {
    const previous = this.past.pop()
    if (previous === undefined) return null
    this.future.push(this.current)
    this.current = previous
    return previous
  }

  redo(): HistorySnapshot<TContent, TSelection> | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(this.current)
    this.current = next
    return next
  }
}

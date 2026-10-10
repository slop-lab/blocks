import type { LargeContentBlock, LargeContentPage, PartialBlockRead } from "./types"

type Listener = () => void

export const includePinnedIndex = (range: readonly number[], pinned: number | null) => {
  if (pinned === null || range.includes(pinned)) return [...range]
  return [...range, pinned].sort((left, right) => left - right)
}

export class LargeContentCache {
  private readonly blocks = new Map<number, LargeContentBlock>()
  private readonly listeners = new Map<number, Set<Listener>>()
  private total: number

  constructor(count: number) {
    this.total = count
  }

  get count() {
    return this.total
  }

  get(index: number) {
    return this.blocks.get(index)
  }

  mergePage(page: LargeContentPage) {
    this.total = page.total
    for (const block of page.blocks) this.mergeBlock(block)
  }

  mergeBlock(block: LargeContentBlock) {
    const current = this.blocks.get(block.index)
    if (current !== undefined && current.revision >= block.revision) return
    this.blocks.set(block.index, block)
    for (const listener of this.listeners.get(block.index) ?? []) listener()
  }

  read(indices: readonly number[]): PartialBlockRead {
    const loaded: LargeContentBlock[] = []
    const missing: number[] = []
    for (const index of indices) {
      const block = this.blocks.get(index)
      if (block === undefined) missing.push(index)
      else loaded.push(block)
    }
    return { loaded, missing, continuation: missing[0] ?? null }
  }

  subscribe(index: number, listener: Listener) {
    const listeners = this.listeners.get(index) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(index, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(index)
    }
  }
}

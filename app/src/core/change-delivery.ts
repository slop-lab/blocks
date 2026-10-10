import type { ChangeEvent, ChangeOrigin } from "./types"

export type DeliveryPolicy =
  | { readonly mode: "immediate" | "manual" }
  | { readonly mode: "debounce"; readonly delay: number; readonly maxWait: number }
  | { readonly mode: "throttle"; readonly interval: number }

export type ChangeBatch = {
  readonly epoch: number
  readonly beforeVersion: number
  readonly version: number
  readonly changedBlockIds: readonly string[]
  readonly origins: readonly ChangeOrigin[]
  readonly count: number
}

export class ChangeDelivery {
  private pending: ChangeBatch | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private deadline: ReturnType<typeof setTimeout> | undefined
  private active = true

  constructor(
    private readonly publish: (batch: ChangeBatch) => void,
    private policy: DeliveryPolicy,
  ) {}

  push(event: ChangeEvent | null) {
    if (!this.active || event === null) return
    if (this.pending !== null && this.pending.epoch !== event.epoch) this.flush()
    const prior = this.pending
    this.pending = {
      epoch: event.epoch,
      beforeVersion: prior?.beforeVersion ?? event.beforeVersion ?? event.version - 1,
      version: event.version,
      changedBlockIds: [...new Set([...(prior?.changedBlockIds ?? []), ...event.changedBlockIds])],
      origins: [...new Set([...(prior?.origins ?? []), event.origin])],
      count: (prior?.count ?? 0) + 1,
    }
    switch (this.policy.mode) {
      case "immediate":
        this.flush()
        break
      case "manual":
        break
      case "throttle":
        this.timer ??= setTimeout(() => this.flush(), this.policy.interval)
        break
      case "debounce":
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), this.policy.delay)
        this.deadline ??= setTimeout(() => this.flush(), this.policy.maxWait)
        break
    }
  }

  configure(policy: DeliveryPolicy) {
    this.flush()
    this.policy = policy
  }

  flush() {
    clearTimeout(this.timer)
    clearTimeout(this.deadline)
    this.timer = undefined
    this.deadline = undefined
    const batch = this.pending
    this.pending = null
    if (this.active && batch !== null) this.publish(batch)
  }

  dispose() {
    this.active = false
    this.pending = null
    clearTimeout(this.timer)
    clearTimeout(this.deadline)
  }
}

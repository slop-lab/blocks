import type { BlockDocument } from "./types"

export type ExternalUpdate = {
  readonly epoch: number
  readonly baseVersion: number
  readonly document: BlockDocument
}

export type SessionClock = {
  readonly epoch: number
  readonly version: number
  readonly composing: boolean
  readonly pending: unknown | null
}

export type ExternalDecision =
  | { readonly kind: "applied"; readonly document: BlockDocument; readonly nextVersion: number }
  | { readonly kind: "deferred"; readonly update: ExternalUpdate }
  | { readonly kind: "conflict"; readonly expected: number; readonly received: number }
  | { readonly kind: "stale_epoch"; readonly expected: number; readonly received: number }

export const decideExternalUpdate = (
  clock: SessionClock,
  update: ExternalUpdate,
): ExternalDecision => {
  if (update.epoch !== clock.epoch) {
    return { kind: "stale_epoch", expected: clock.epoch, received: update.epoch }
  }
  if (update.baseVersion !== clock.version) {
    return { kind: "conflict", expected: clock.version, received: update.baseVersion }
  }
  if (clock.composing) return { kind: "deferred", update }
  return { kind: "applied", document: update.document, nextVersion: clock.version + 1 }
}

export const resetSession = (clock: SessionClock) => ({
  epoch: clock.epoch + 1,
  version: 0,
  composing: false,
  pending: null,
  historyReset: true,
})

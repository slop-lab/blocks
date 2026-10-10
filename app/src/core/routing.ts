import type { BlockDocument } from "./types"

export type InteractionRoute =
  | { readonly kind: "native" }
  | { readonly kind: "host"; readonly actionHandle: string }
  | { readonly kind: "unavailable"; readonly reason: string }
export type ActionTarget = {
  readonly modelId: string
  readonly epoch: number
  readonly blockId: string
  readonly dependencyVersion: number
}
export type HostActionRequest = {
  readonly requestId: string
  readonly actionHandle: string
  readonly target: ActionTarget
  readonly input: unknown
  readonly signal: AbortSignal
}
export type HostActionResult =
  | { readonly status: "completed" }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "stale" }

export const resolveRoute = (routes: readonly InteractionRoute[]): InteractionRoute => {
  if (routes.length > 1)
    return { kind: "unavailable", reason: "Conflicting exclusive input routes" }
  return routes[0] ?? { kind: "native" }
}

export const dispatchInput = (
  route: InteractionRoute,
  handlers: {
    readonly native: () => boolean
    readonly host: (actionHandle: string) => Promise<HostActionResult>
    readonly unavailable: (reason: string) => void
  },
): { readonly handled: boolean; readonly settled?: Promise<HostActionResult> } => {
  switch (route.kind) {
    case "native":
      return { handled: handlers.native() }
    case "host":
      return { handled: true, settled: handlers.host(route.actionHandle) }
    case "unavailable":
      handlers.unavailable(route.reason)
      return { handled: true }
  }
}

export class ActionRequests {
  private readonly pending = new Map<string, AbortController>()
  constructor(private readonly isCurrent: (target: ActionTarget) => boolean) {}

  request(
    input: Omit<HostActionRequest, "requestId" | "signal">,
    handler: (request: HostActionRequest) => Promise<HostActionResult>,
  ) {
    const requestId = crypto.randomUUID()
    const controller = new AbortController()
    this.pending.set(requestId, controller)
    const settled = Promise.resolve().then(async (): Promise<HostActionResult> => {
      try {
        if (controller.signal.aborted || !this.isCurrent(input.target)) return { status: "stale" }
        const result = await handler({ ...input, requestId, signal: controller.signal })
        return controller.signal.aborted || !this.isCurrent(input.target)
          ? { status: "stale" }
          : result
      } catch (error) {
        return {
          status: "failed",
          message: error instanceof Error ? error.message : "Host action failed",
        }
      } finally {
        this.pending.delete(requestId)
      }
    })
    return { requestId, settled, cancel: () => controller.abort() }
  }
  dispose() {
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
  }
}

export class PersistenceBaseline {
  private baseline: string
  private latestAcknowledged = 0
  private sequence = 0
  constructor(document: BlockDocument) {
    this.baseline = JSON.stringify(document)
  }
  begin(document: BlockDocument) {
    return { requestId: ++this.sequence, serialized: JSON.stringify(document) }
  }
  acknowledge(saved: { readonly requestId: number; readonly serialized: string }) {
    if (saved.requestId <= this.latestAcknowledged) return false
    this.latestAcknowledged = saved.requestId
    this.baseline = saved.serialized
    return true
  }
  isDirty(current: BlockDocument) {
    return this.baseline !== JSON.stringify(current)
  }
}

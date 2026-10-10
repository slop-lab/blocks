import {
  ActionRequests,
  type ActionTarget,
  type HostActionRequest,
  type HostActionResult,
  PersistenceBaseline,
} from "@block-editor/bindings"

export type { ActionTarget, HostActionRequest, HostActionResult }
export { ActionRequests, PersistenceBaseline }

export type InteractionRoute =
  | { readonly kind: "native" }
  | { readonly kind: "host"; readonly actionHandle: string }
  | { readonly kind: "unavailable"; readonly reason: string }
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

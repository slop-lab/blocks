export type CutPolicy = "remove-after-write" | "host-deferred" | "copy-only"

export type CutRouteOptions = {
  readonly policy: CutPolicy
  readonly write: () => Promise<void>
  readonly remove: () => void
  readonly markPending: () => void
}

export type CutRoute = {
  readonly consumed: true
  readonly completion: Promise<
    | { readonly kind: "removed" }
    | { readonly kind: "deferred" }
    | { readonly kind: "copied" }
    | { readonly kind: "write-failed" }
  >
}

export const routeCut = (options: CutRouteOptions): CutRoute => {
  const completion = options
    .write()
    .then(() => {
      switch (options.policy) {
        case "remove-after-write":
          options.remove()
          return { kind: "removed" as const }
        case "host-deferred":
          options.markPending()
          return { kind: "deferred" as const }
        case "copy-only":
          return { kind: "copied" as const }
        default:
          return options.policy satisfies never
      }
    })
    .catch((error: unknown) => {
      if (error instanceof Error || error instanceof DOMException)
        return { kind: "write-failed" as const }
      throw error
    })
  return { consumed: true, completion }
}

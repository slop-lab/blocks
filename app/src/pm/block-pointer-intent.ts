export type PointerIntentBounds = {
  readonly block: DOMRect
  readonly rail: DOMRect
}

export const insideRailCorridor = (
  point: { readonly x: number; readonly y: number },
  bounds: PointerIntentBounds,
): boolean => {
  const padding = 8
  return (
    point.x >= Math.min(bounds.rail.left, bounds.block.left) - padding &&
    point.x <= Math.max(bounds.rail.right, bounds.block.right) + padding &&
    point.y >= Math.min(bounds.rail.top, bounds.block.top) - padding &&
    point.y <= Math.max(bounds.rail.bottom, bounds.block.bottom) + padding
  )
}

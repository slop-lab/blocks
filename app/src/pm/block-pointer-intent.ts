export type PointerIntentBounds = {
  readonly block: DOMRect
  readonly rail: DOMRect
}

export const insideRailCorridor = (
  point: { readonly x: number; readonly y: number },
  bounds: PointerIntentBounds,
): boolean => {
  const padding = 8
  const blockEdge = bounds.rail.right <= bounds.block.left ? bounds.block.left : bounds.block.right
  return (
    point.x >= Math.min(bounds.rail.left, blockEdge) - padding &&
    point.x <= Math.max(bounds.rail.right, blockEdge) + padding &&
    point.y >= bounds.rail.top - padding &&
    point.y <= bounds.rail.bottom + padding
  )
}

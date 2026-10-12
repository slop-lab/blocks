type BlockSelectionContext = {
  readonly contains: (target: Node) => boolean
  readonly updateToolbar: (element: HTMLElement | null) => void
}

export const createBlockSelectionContext = (
  persistent: readonly HTMLElement[],
): BlockSelectionContext => {
  const elements = new Set<HTMLElement>(persistent)
  let toolbar: HTMLElement | null = null
  return {
    contains: (target) =>
      Array.from(elements).some((element) => element === target || element.contains(target)),
    updateToolbar: (element) => {
      if (toolbar !== null) elements.delete(toolbar)
      toolbar = element
      if (toolbar !== null) elements.add(toolbar)
    },
  }
}

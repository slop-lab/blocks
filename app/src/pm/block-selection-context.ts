type BlockSelectionContext = {
  readonly contains: (target: Node) => boolean
  readonly updateToolbar: (element: HTMLElement | null) => void
}

export const createBlockSelectionContext = (
  persistent: readonly HTMLElement[],
  ownerId?: string,
): BlockSelectionContext => {
  const elements = new Set<HTMLElement>(persistent)
  const markOwner = (element: HTMLElement) => {
    if (ownerId !== undefined) element.dataset["editorContextId"] = ownerId
  }
  persistent.forEach(markOwner)
  let toolbar: HTMLElement | null = null
  return {
    contains: (target) =>
      Array.from(elements).some((element) => element === target || element.contains(target)),
    updateToolbar: (element) => {
      if (toolbar !== null) elements.delete(toolbar)
      toolbar = element
      if (toolbar !== null) {
        markOwner(toolbar)
        elements.add(toolbar)
      }
    },
  }
}

export const isBlockContextTarget = (target: Node, ownerId: string): boolean =>
  target instanceof Element &&
  target.closest<HTMLElement>("[data-editor-context-id]")?.dataset["editorContextId"] === ownerId

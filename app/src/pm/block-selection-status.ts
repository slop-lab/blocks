type BlockSelectionStatus = {
  readonly update: (blockIds: readonly string[]) => void
  readonly destroy: () => void
}

export const createBlockSelectionStatus = (editor: HTMLElement): BlockSelectionStatus => {
  const element = editor.ownerDocument.createElement("div")
  element.className = "block-selection-status"
  element.role = "status"
  element.ariaLive = "polite"
  element.hidden = true
  editor.before(element)
  return {
    update: (blockIds) => {
      element.hidden = blockIds.length === 0
      element.textContent = blockIds.length === 0 ? "" : `${blockIds.length} blocks selected`
    },
    destroy: () => element.remove(),
  }
}

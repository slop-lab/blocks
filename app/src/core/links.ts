export type InternalLinkTarget =
  | { readonly kind: "page"; readonly pageId: string }
  | { readonly kind: "block"; readonly pageId?: string; readonly blockId: string }

const internalId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u

export const parseInternalTarget = (value: string): InternalLinkTarget | null => {
  if (value.startsWith("page-id:")) {
    const pageId = value.slice("page-id:".length)
    return internalId.test(pageId) ? { kind: "page", pageId } : null
  }
  if (!value.startsWith("block-id:")) return null
  const parts = value.slice("block-id:".length).split("/")
  if (parts.length === 1 && parts[0] !== undefined && internalId.test(parts[0]))
    return { kind: "block", blockId: parts[0] }
  const [pageId, blockId] = parts
  return parts.length === 2 &&
    pageId !== undefined &&
    blockId !== undefined &&
    internalId.test(pageId) &&
    internalId.test(blockId)
    ? { kind: "block", pageId, blockId }
    : null
}

export const safeLinkHref = (value: string): string | null => {
  const href = value.trim()
  if (parseInternalTarget(href) !== null) return href
  if ((href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#")) return href
  try {
    const protocol = new URL(href).protocol
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" ? href : null
  } catch (caught) {
    if (caught instanceof TypeError) return null
    throw caught
  }
}

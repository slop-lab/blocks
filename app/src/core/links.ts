export const safeLinkHref = (value: string): string | null => {
  const href = value.trim()
  if ((href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#")) return href
  try {
    const protocol = new URL(href).protocol
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" ? href : null
  } catch (caught) {
    if (caught instanceof TypeError) return null
    throw caught
  }
}

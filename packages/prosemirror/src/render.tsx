import type { BlockSnapshot } from "@slop-lab/blocks"
import { Fragment, type ReactNode } from "react"

const safeHref = (value: string): string | null => {
  if (value.startsWith("/") || value.startsWith("#")) return value
  try {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" ? value : null
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return null
  }
}

export const renderInline = (block: BlockSnapshot): ReactNode => {
  let offset = 0
  return block.content.map((inline) => {
    const key = `${block.id}:${offset}`
    offset += inline.kind === "text" ? Math.max(1, inline.text.length) : 1
    if (inline.kind === "opaque") return <span key={key}>[미지원 인라인]</span>
    let text: ReactNode = inline.text
    for (const mark of inline.marks) {
      if (typeof mark !== "object" || mark === null || !("type" in mark)) continue
      if (mark.type === "strong") text = <strong>{text}</strong>
      if (mark.type === "em") text = <em>{text}</em>
      if (mark.type === "code") text = <code>{text}</code>
      if (
        mark.type === "link" &&
        "attrs" in mark &&
        typeof mark.attrs === "object" &&
        mark.attrs !== null &&
        "href" in mark.attrs &&
        typeof mark.attrs.href === "string"
      ) {
        const href = safeHref(mark.attrs.href)
        if (href !== null) text = <a href={href}>{text}</a>
      }
    }
    return <Fragment key={key}>{text}</Fragment>
  })
}

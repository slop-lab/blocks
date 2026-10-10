import type { ReactNode } from "react"
import { Component, createElement } from "react"
import type { BlockDocument, BlockSnapshot } from "./core/types"

export type ViewerOverlay = {
  readonly id: string
  readonly blockId: string
  readonly message: string
}
export type ViewerProps = {
  readonly content: BlockDocument | readonly BlockSnapshot[]
  readonly viewData?: ReadonlyMap<string, unknown>
  readonly overlays?: readonly ViewerOverlay[]
  readonly renderBlock?: (block: BlockSnapshot, viewData: unknown) => ReactNode
}

class BlockBoundary extends Component<
  { readonly children: ReactNode; readonly blockId: string },
  { readonly failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <section role="status">표시 실패 · {this.props.blockId} · 원본 데이터는 유지됩니다.</section>
    ) : (
      this.props.children
    )
  }
}

const RenderBlock = ({
  block,
  renderBlock,
  data,
}: {
  readonly block: BlockSnapshot
  readonly renderBlock: ViewerProps["renderBlock"]
  readonly data: unknown
}) => {
  if (renderBlock !== undefined) {
    const rendered = renderBlock(block, data)
    if (rendered !== undefined) return rendered
  }
  let offset = 0
  const content = block.content.map((inline) => {
    const key = `${block.id}:${offset}`
    offset += inline.kind === "text" ? Math.max(1, inline.text.length) : 1
    if (inline.kind === "opaque") return <span key={key}>[미지원 인라인]</span>
    let text: ReactNode = inline.text
    for (const mark of inline.marks) {
      if (typeof mark !== "object" || mark === null || !("type" in mark)) continue
      if (mark.type === "strong") text = <strong>{text}</strong>
      if (mark.type === "em") text = <em>{text}</em>
      if (mark.type === "code") text = <code>{text}</code>
    }
    return <span key={key}>{text}</span>
  })
  switch (block.type) {
    case "heading": {
      const raw = block.attrs["level"]
      const level =
        typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : 2
      return createElement(`h${level}`, null, content)
    }
    case "paragraph":
    case "caption":
      return <p>{content}</p>
    case "quote":
      return <blockquote>{content}</blockquote>
    case "code":
      return (
        <pre>
          <code>{content}</code>
        </pre>
      )
    default:
      return (
        <section className="opaque-block">
          <strong>{block.type}</strong>
          <p>{content}</p>
          <small>읽기 전용 확장 콘텐츠</small>
        </section>
      )
  }
}

export const BlockViewer = (props: ViewerProps) => {
  const blocks = "blocks" in props.content ? props.content.blocks : props.content
  const known = new Set(blocks.map((block) => block.id))
  return (
    <article className="static-viewer">
      {blocks.map((block) => (
        <div key={block.id} data-block-id={block.id}>
          <BlockBoundary blockId={block.id}>
            <RenderBlock
              block={block}
              renderBlock={props.renderBlock}
              data={props.viewData?.get(block.id)}
            />
          </BlockBoundary>
          {props.overlays
            ?.filter((item) => item.blockId === block.id)
            .map((item) => (
              <aside key={item.id} role="note">
                {item.message}
              </aside>
            ))}
        </div>
      ))}
      {props.overlays
        ?.filter((item) => !known.has(item.blockId))
        .map((item) => (
          <aside key={item.id} role="note">
            위치 소실 · {item.message}
          </aside>
        ))}
    </article>
  )
}

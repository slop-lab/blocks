import type { ReactNode } from "react"
import { Component } from "react"
import type { BlockDocument, BlockRenderer, BlockSnapshot } from "./types.js"

export type ViewerOverlay = {
  readonly id: string
  readonly blockId: string
  readonly message: string
}
export type ViewerProps = {
  readonly content: BlockDocument | readonly BlockSnapshot[]
  readonly renderers: ReadonlyMap<string, BlockRenderer>
  readonly viewData?: ReadonlyMap<string, unknown>
  readonly overlays?: readonly ViewerOverlay[]
  readonly renderUnknown?: BlockRenderer
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

export const BlockViewer = (props: ViewerProps) => {
  const blocks = "blocks" in props.content ? props.content.blocks : props.content
  const known = new Set(blocks.map((block) => block.id))
  return (
    <article className="static-viewer">
      {blocks.map((block) => {
        const renderer = props.renderers.get(block.type) ?? props.renderUnknown
        return (
          <div key={block.id} data-block-id={block.id}>
            <BlockBoundary blockId={block.id}>
              {renderer?.(block, props.viewData?.get(block.id)) ?? block.type}
            </BlockBoundary>
            {props.overlays
              ?.filter((item) => item.blockId === block.id)
              .map((item) => (
                <aside key={item.id} role="note">
                  {item.message}
                </aside>
              ))}
          </div>
        )
      })}
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

import { Pencil2Icon } from "@radix-ui/react-icons"
import { useSyncExternalStore } from "react"
import type { LargeContentCache } from "./model"

type VirtualBlockRowProps = Readonly<{
  cache: LargeContentCache
  index: number
  annotated: boolean
  onEdit: (index: number) => void
}>

export const VirtualBlockRow = ({ cache, index, annotated, onEdit }: VirtualBlockRowProps) => {
  const block = useSyncExternalStore(
    (listener) => cache.subscribe(index, listener),
    () => cache.get(index),
  )
  return (
    <article
      className={annotated ? "large-row large-row--annotated" : "large-row"}
      data-large-row={index}
      aria-busy={block === undefined}
    >
      <span className="large-row__index">{String(index + 1).padStart(4, "0")}</span>
      {block === undefined ? (
        <p className="large-row__loading">문단을 불러오는 중...</p>
      ) : (
        <p>{block.text}</p>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={`${index + 1}번째 문단 편집`}
        disabled={block === undefined}
        onClick={() => onEdit(index)}
      >
        <Pencil2Icon />
      </button>
    </article>
  )
}

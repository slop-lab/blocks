import { DownloadIcon, MagnifyingGlassIcon, ReloadIcon } from "@radix-ui/react-icons"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { largeContentApi } from "./api"
import { BlockEditDialog } from "./BlockEditDialog"
import { includePinnedIndex, LargeContentCache } from "./model"
import type { LargeContentBlock } from "./types"
import { VirtualBlockRow } from "./VirtualBlockRow"
import "./large-content.css"

const PAGE_SIZE = 40
const ROW_ESTIMATE = 72

export const LargeContentWorkspace = () => {
  const cache = useMemo(() => new LargeContentCache(1_600), [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const requestedPages = useRef(new Set<number>())
  const openRequestRef = useRef(0)
  const searchRequestRef = useRef(0)
  const [active, setActive] = useState<LargeContentBlock | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [annotationTarget, setAnnotationTarget] = useState("")
  const [annotations, setAnnotations] = useState<ReadonlySet<number>>(() => new Set())

  const virtualizer = useVirtualizer({
    count: cache.count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 6,
    rangeExtractor: (range) =>
      includePinnedIndex(defaultRangeExtractor(range), active?.index ?? null),
  })
  const virtualItems = virtualizer.getVirtualItems()

  const loadPage = useCallback(
    async (pageStart: number, retry = false) => {
      if (!retry && requestedPages.current.has(pageStart)) return
      requestedPages.current.add(pageStart)
      setError(null)
      try {
        cache.mergePage(await largeContentApi.page(pageStart, PAGE_SIZE))
      } catch {
        setError("문단을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
      }
    },
    [cache],
  )

  useEffect(() => {
    const starts = new Set(
      virtualItems.map((item) => Math.floor(item.index / PAGE_SIZE) * PAGE_SIZE),
    )
    if (starts.size === 0) starts.add(0)
    for (const start of starts) void loadPage(start)
  }, [loadPage, virtualItems])

  const openEditor = useCallback(
    async (index: number, focus = true) => {
      if (index < 0 || index >= cache.count) return
      const request = openRequestRef.current + 1
      openRequestRef.current = request
      try {
        const cached = cache.get(index)
        const block =
          cached ?? (await largeContentApi.block(`paragraph-${String(index).padStart(4, "0")}`))
        if (openRequestRef.current !== request) return
        cache.mergeBlock(block)
        setActive(cache.get(index) ?? block)
        virtualizer.scrollToIndex(index, { align: "center" })
        if (!focus) return
        requestAnimationFrame(() =>
          document.querySelector<HTMLTextAreaElement>(".large-dialog textarea")?.focus(),
        )
      } catch {
        if (openRequestRef.current === request)
          setError("문단을 열지 못했습니다. 잠시 후 다시 시도하세요.")
      }
    },
    [cache, virtualizer],
  )

  const reveal = (focus: boolean) => {
    const match = /(?:paragraph-)?(\d+)/.exec(annotationTarget.trim())
    if (match === null) return
    const raw = Number(match[1])
    const index = annotationTarget.startsWith("paragraph-") ? raw : raw - 1
    if (index < 0 || index >= cache.count) return
    setAnnotations((current) => new Set([...current, index]))
    virtualizer.scrollToIndex(index, { align: "center" })
    if (focus) void openEditor(index, true)
  }

  const search = async () => {
    const request = searchRequestRef.current + 1
    searchRequestRef.current = request
    try {
      const [result] = await largeContentApi.search(query)
      if (searchRequestRef.current === request && result !== undefined) {
        cache.mergeBlock(result)
        virtualizer.scrollToIndex(result.index, { align: "center" })
      }
    } catch {
      if (searchRequestRef.current === request)
        setError("검색하지 못했습니다. 잠시 후 다시 시도하세요.")
    }
  }

  return (
    <section className="large-workspace" aria-label="긴 문서 작업 공간">
      <header className="large-workspace__header">
        <div>
          <span className="eyebrow">문서 보관함</span>
          <h1>긴 문서 탐색</h1>
          <p>필요한 문단을 빠르게 찾고, 작성 중인 내용을 잃지 않고 수정하세요.</p>
        </div>
        <a className="button button--secondary" href={largeContentApi.exportUrl} download>
          <DownloadIcon /> 전체 문서 내보내기
        </a>
      </header>
      <section className="large-tools" aria-label="긴 문서 도구">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <label className="field">
            <span>문서 검색</span>
            <div className="large-tools__cluster">
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
              <button className="button button--secondary" type="submit">
                <MagnifyingGlassIcon /> 검색
              </button>
            </div>
          </label>
        </form>
        <div className="field">
          <span>문단 표시 또는 이동</span>
          <div className="large-tools__cluster">
            <input
              aria-label="문단 ID 또는 번호"
              value={annotationTarget}
              onChange={(event) => setAnnotationTarget(event.target.value)}
            />
            <button className="button button--ghost" type="button" onClick={() => reveal(false)}>
              문단 보기
            </button>
            <button className="button button--secondary" type="button" onClick={() => reveal(true)}>
              열어서 편집
            </button>
          </div>
        </div>
      </section>
      {error !== null && (
        <div className="large-error" role="alert">
          <span>{error}</span>
          <button
            className="button button--secondary"
            type="button"
            onClick={() =>
              void loadPage(Math.floor((virtualItems[0]?.index ?? 0) / PAGE_SIZE) * PAGE_SIZE, true)
            }
          >
            <ReloadIcon /> 다시 시도
          </button>
        </div>
      )}
      <section className="large-scroll" ref={scrollRef} aria-label="문서 문단 목록">
        <div className="large-scroll__sizer" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((item) => (
            <div
              className="large-scroll__item"
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <VirtualBlockRow
                cache={cache}
                index={item.index}
                annotated={annotations.has(item.index)}
                onEdit={(index) => void openEditor(index)}
              />
            </div>
          ))}
        </div>
      </section>
      <footer className="large-workspace__status" aria-live="polite">
        화면에 표시된 문단 {virtualItems.length}개 · 전체 {cache.count}개 · 표시 {annotations.size}
        개
      </footer>
      {active !== null && (
        <BlockEditDialog
          block={active}
          onClose={() => setActive(null)}
          onSaved={(block) => cache.mergeBlock(block)}
          onMove={(index, focus) => void openEditor(index, focus)}
        />
      )}
    </section>
  )
}

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
        setError("Could not load the paragraphs. Try again shortly.")
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
          setError("Could not open the paragraph. Try again shortly.")
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
        setError("Could not complete the search. Try again shortly.")
    }
  }

  return (
    <section className="large-workspace" aria-label="Long document workspace">
      <header className="large-workspace__header">
        <div>
          <span className="eyebrow">Document archive</span>
          <h1>Navigate long documents</h1>
          <p>Find the paragraph you need quickly and edit it without losing your draft.</p>
        </div>
        <a className="button button--secondary" href={largeContentApi.exportUrl} download>
          <DownloadIcon /> Export full document
        </a>
      </header>
      <section className="large-tools" aria-label="Long document tools">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <label className="field">
            <span>Search document</span>
            <div className="large-tools__cluster">
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
              <button className="button button--secondary" type="submit">
                <MagnifyingGlassIcon /> Search
              </button>
            </div>
          </label>
        </form>
        <div className="field">
          <span>Reveal or navigate to a paragraph</span>
          <div className="large-tools__cluster">
            <input
              aria-label="Paragraph ID or number"
              value={annotationTarget}
              onChange={(event) => setAnnotationTarget(event.target.value)}
            />
            <button className="button button--ghost" type="button" onClick={() => reveal(false)}>
              Reveal paragraph
            </button>
            <button className="button button--secondary" type="button" onClick={() => reveal(true)}>
              Open for editing
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
            <ReloadIcon /> Try again
          </button>
        </div>
      )}
      <section className="large-scroll" ref={scrollRef} aria-label="Document paragraph list">
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
        {virtualItems.length} visible paragraphs · {cache.count} total · {annotations.size}{" "}
        highlighted
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

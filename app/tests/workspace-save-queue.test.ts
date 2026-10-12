import { describe, expect, it, vi } from "vitest"
import type { EntityRecord, WorkspacePayload } from "../src/features/workspace/workspace-api"
import {
  mergeWorkspacePayload,
  type QueueRecord,
  WorkspaceSaveQueue,
} from "../src/features/workspace/workspace-save-queue"

const entityRecord = <T>(id: string, revision: number, content: T): EntityRecord<T> => ({
  documentId: id,
  revision,
  content,
  metadata: {},
  history: [],
})
const record = (id: string, revision: number, content: unknown): QueueRecord =>
  entityRecord(id, revision, content)

describe("workspace entity save queue", () => {
  it("resumes saves after a StrictMode effect cleanup", async () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const queue = new WorkspaceSaveQueue(
      async ({ target, baseline, content }) => {
        saved.push(target.id)
        return record(target.id, baseline.revision + 1, content)
      },
      () => undefined,
      () => undefined,
    )

    queue.dispose()
    queue.resume()
    queue.stage({ kind: "sources", id: "source-a" }, record("source-a", 1, {}), {
      text: "after-remount",
    })
    await vi.runAllTimersAsync()

    expect(saved).toEqual(["source-a"])
    queue.dispose()
    vi.useRealTimers()
  })

  it("saves page and database drafts through independent queues", async () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const queue = new WorkspaceSaveQueue(
      async ({ target, baseline, content }) => {
        saved.push(`${target.kind}:${target.id}`)
        return record(target.id, baseline.revision + 1, content)
      },
      () => undefined,
      () => undefined,
      600,
    )

    queue.stage({ kind: "pages", id: "page-a" }, record("page-a", 1, {}), { text: "A" })
    queue.stage({ kind: "databases", id: "db-b" }, record("db-b", 1, {}), { rows: ["B"] })
    await vi.advanceTimersByTimeAsync(600)

    expect(saved).toEqual(["pages:page-a", "databases:db-b"])
    expect(queue.isDirty({ kind: "pages", id: "page-a" })).toBe(false)
    expect(queue.isDirty({ kind: "databases", id: "db-b" })).toBe(false)
    queue.dispose()
    vi.useRealTimers()
  })

  it("keeps a newer draft dirty when an older acknowledgement arrives", async () => {
    vi.useFakeTimers()
    let release = () => {}
    const first = new Promise<void>((resolve) => {
      release = resolve
    })
    const submitted: {
      readonly content: unknown
      readonly revision: number
      readonly cause?: string
    }[] = []
    const settled: { readonly clean: boolean; readonly cause?: string }[] = []
    const queue = new WorkspaceSaveQueue(
      async ({ target, baseline, content, causality }) => {
        submitted.push({
          content,
          revision: baseline.revision,
          ...(causality === undefined ? {} : { cause: causality.causeId }),
        })
        if (submitted.length === 1) await first
        return record(target.id, baseline.revision + 1, content)
      },
      ({ clean, causality }) =>
        settled.push({ clean, ...(causality === undefined ? {} : { cause: causality.causeId }) }),
      () => undefined,
      600,
    )
    const target = { kind: "pages" as const, id: "page-a" }
    queue.stage(
      target,
      record("page-a", 1, {}),
      { text: "first" },
      {
        generation: 1,
        causeId: "cause-a",
        baselineRevision: 1,
      },
    )
    await vi.advanceTimersByTimeAsync(600)
    queue.stage(
      target,
      record("page-a", 1, {}),
      { text: "newest" },
      {
        generation: 2,
        causeId: "cause-b",
        baselineRevision: 1,
      },
    )
    release()
    await vi.runAllTimersAsync()

    expect(submitted).toEqual([
      { content: { text: "first" }, revision: 1, cause: "cause-a" },
      { content: { text: "newest" }, revision: 2, cause: "cause-b" },
    ])
    expect(settled).toEqual([
      { clean: false, cause: "cause-a" },
      { clean: true, cause: "cause-b" },
    ])
    expect(queue.isDirty(target)).toBe(false)
    queue.dispose()
    vi.useRealTimers()
  })

  it("defers saves during composition and retries preserved drafts", async () => {
    vi.useFakeTimers()
    let offline = true
    const submitted: unknown[] = []
    const queue = new WorkspaceSaveQueue(
      async ({ target, baseline, content }) => {
        submitted.push(content)
        if (offline) throw new TypeError("offline")
        return record(target.id, baseline.revision + 1, content)
      },
      () => undefined,
      () => {},
      600,
    )
    const target = { kind: "sources" as const, id: "shared" }
    queue.setComposing(target, true)
    queue.stage(target, record("shared", 1, {}), { text: "draft" })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(submitted).toEqual([])
    queue.setComposing(target, false)
    await vi.advanceTimersByTimeAsync(600)
    expect(queue.isDirty(target)).toBe(true)
    offline = false
    queue.retry()
    await vi.runAllTimersAsync()
    expect(submitted).toEqual([{ text: "draft" }, { text: "draft" }])
    expect(queue.isDirty(target)).toBe(false)
    queue.dispose()
    vi.useRealTimers()
  })

  it("continues saving unrelated entities while one target is composing", async () => {
    vi.useFakeTimers()
    const submitted: string[] = []
    const queue = new WorkspaceSaveQueue(
      async ({ target, baseline, content }) => {
        submitted.push(`${target.kind}:${target.id}`)
        return record(target.id, baseline.revision + 1, content)
      },
      () => {},
      () => {},
      600,
    )
    const composingTarget = { kind: "sources" as const, id: "shared" }
    queue.setComposing(composingTarget, true)
    queue.stage(composingTarget, record("shared", 1, {}), { text: "draft" })
    queue.stage({ kind: "pages", id: "page-a" }, record("page-a", 1, {}), { text: "page" })

    await vi.advanceTimersByTimeAsync(600)

    expect(submitted).toEqual(["pages:page-a"])
    expect(queue.isDirty(composingTarget)).toBe(true)
    queue.dispose()
    vi.useRealTimers()
  })

  it("pauses a conflicted target until an explicit rebase", async () => {
    vi.useFakeTimers()
    const target = { kind: "sources" as const, id: "shared" }
    const revisions: number[] = []
    let conflicted = true
    const queue = new WorkspaceSaveQueue(
      async ({ baseline, content }) => {
        revisions.push(baseline.revision)
        if (conflicted) throw new TypeError("conflict")
        return record(target.id, baseline.revision + 1, content)
      },
      () => {},
      () => "pause",
      600,
    )
    queue.stage(target, record("shared", 1, {}), { text: "local" })
    await vi.advanceTimersByTimeAsync(600)

    queue.retry()
    await vi.runAllTimersAsync()
    conflicted = false
    queue.rebase(target, record("shared", 2, { text: "remote" }))
    await vi.runAllTimersAsync()

    expect(revisions).toEqual([1, 2])
    expect(queue.isDirty(target)).toBe(false)
    queue.dispose()
    vi.useRealTimers()
  })
})

it("merges polling records only for clean entities", () => {
  const current: WorkspacePayload = {
    tree: entityRecord("tree", 1, { id: "tree", version: 1, pages: [] }),
    documents: [
      entityRecord("page-a", 1, {
        pageId: "page-a",
        version: 1,
        blocks: [{ id: "p", type: "paragraph", text: "local draft" }],
      }),
    ],
    databases: [
      entityRecord("db", 1, { id: "db", version: 1, name: "Tasks", properties: [], rows: [] }),
    ],
    sources: [],
  }
  const remote: WorkspacePayload = {
    ...current,
    documents: [
      entityRecord("page-a", 2, {
        pageId: "page-a",
        version: 2,
        blocks: [{ id: "p", type: "paragraph", text: "stale remote" }],
      }),
    ],
    databases: [
      entityRecord("db", 2, {
        id: "db",
        version: 2,
        name: "Tasks",
        properties: [],
        rows: [],
      }),
    ],
  }

  const merged = mergeWorkspacePayload(current, remote, (target) => target.id === "page-a")

  expect(merged.documents[0]?.content.blocks[0]).toEqual({
    id: "p",
    type: "paragraph",
    text: "local draft",
  })
  expect(merged.databases[0]?.revision).toBe(2)
})

it("ignores an older poll record for a clean entity", () => {
  const current: WorkspacePayload = {
    tree: entityRecord("tree", 3, { id: "tree", version: 3, pages: [] }),
    documents: [],
    databases: [],
    sources: [],
  }
  const remote: WorkspacePayload = {
    ...current,
    tree: entityRecord("tree", 2, { id: "tree", version: 2, pages: [] }),
  }

  const merged = mergeWorkspacePayload(current, remote, () => false)

  expect(merged.tree.revision).toBe(3)
})

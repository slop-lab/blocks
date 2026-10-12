import { afterEach, describe, expect, it, vi } from "vitest"
import type { QueueRecord, SaveRequest } from "../src/features/workspace/workspace-save-queue"
import { WorkspaceSaveQueue } from "../src/features/workspace/workspace-save-queue"

const record = (id: string, revision: number, content: unknown): QueueRecord => ({
  documentId: id,
  revision,
  content,
  metadata: {},
  history: [],
})

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const target = { kind: "sources" as const, id: "shared" }

afterEach(() => {
  vi.useRealTimers()
})

describe("workspace save queue lineage", () => {
  it("saves a rebased draft after the superseded request reports a conflict", async () => {
    vi.useFakeTimers()
    const first = deferred<QueueRecord>()
    const requests: SaveRequest[] = []
    const settledRevisions: number[] = []
    const onError = vi.fn(() => "pause")
    const queue = new WorkspaceSaveQueue(
      (request) => {
        requests.push(request)
        if (requests.length === 1) return first.promise
        return Promise.resolve(record(target.id, request.baseline.revision + 1, request.content))
      },
      ({ saved }) => settledRevisions.push(saved.revision),
      onError,
      600,
    )

    queue.stage(target, record(target.id, 1, {}), { text: "A" })
    await vi.advanceTimersByTimeAsync(600)
    queue.stage(target, record(target.id, 1, {}), { text: "B" })
    queue.rebase(target, record(target.id, 3, { text: "remote" }))
    first.reject(new TypeError("late conflict"))
    await vi.runAllTimersAsync()

    expect(
      requests.map(({ baseline, content }) => ({ revision: baseline.revision, content })),
    ).toEqual([
      { revision: 1, content: { text: "A" } },
      { revision: 3, content: { text: "B" } },
    ])
    expect(onError).not.toHaveBeenCalled()
    expect(settledRevisions).toEqual([4])
    expect(queue.isDirty(target)).toBe(false)
    queue.dispose()
  })

  it("does not regress a rebased draft when the superseded request succeeds", async () => {
    vi.useFakeTimers()
    const first = deferred<QueueRecord>()
    const requests: SaveRequest[] = []
    const settledRevisions: number[] = []
    const queue = new WorkspaceSaveQueue(
      (request) => {
        requests.push(request)
        if (requests.length === 1) return first.promise
        return Promise.resolve(record(target.id, request.baseline.revision + 1, request.content))
      },
      ({ saved }) => settledRevisions.push(saved.revision),
      () => undefined,
      600,
    )

    queue.stage(target, record(target.id, 1, {}), { text: "A" })
    await vi.advanceTimersByTimeAsync(600)
    queue.stage(target, record(target.id, 1, {}), { text: "B" })
    queue.rebase(target, record(target.id, 3, { text: "remote" }))
    first.resolve(record(target.id, 2, { text: "A" }))
    await vi.runAllTimersAsync()

    expect(
      requests.map(({ baseline, content }) => ({ revision: baseline.revision, content })),
    ).toEqual([
      { revision: 1, content: { text: "A" } },
      { revision: 3, content: { text: "B" } },
    ])
    expect(settledRevisions).toEqual([4])
    expect(queue.isDirty(target)).toBe(false)
    queue.dispose()
  })

  it("does not let a discarded request settle or remove a replacement entry", async () => {
    vi.useFakeTimers()
    const first = deferred<QueueRecord>()
    const requests: SaveRequest[] = []
    const settledRevisions: number[] = []
    const queue = new WorkspaceSaveQueue(
      (request) => {
        requests.push(request)
        if (requests.length === 1) return first.promise
        return Promise.resolve(record(target.id, request.baseline.revision + 1, request.content))
      },
      ({ saved }) => settledRevisions.push(saved.revision),
      () => undefined,
      600,
    )

    queue.stage(target, record(target.id, 1, {}), { text: "discarded" })
    await vi.advanceTimersByTimeAsync(600)
    queue.discard(target)
    queue.stage(target, record(target.id, 10, {}), { text: "replacement" })
    first.resolve(record(target.id, 2, { text: "discarded" }))
    await vi.runAllTimersAsync()

    expect(
      requests.map(({ baseline, content }) => ({ revision: baseline.revision, content })),
    ).toEqual([
      { revision: 1, content: { text: "discarded" } },
      { revision: 10, content: { text: "replacement" } },
    ])
    expect(settledRevisions).toEqual([11])
    expect(queue.isDirty(target)).toBe(false)
    queue.dispose()
  })
})

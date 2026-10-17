import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { createFixtureModel } from "../server/agent/model.mjs"
import {
  AgentCommandConflictError,
  AgentRequestConflictError,
  createAgentRuntime,
} from "../server/agent/runtime.mjs"

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const input = (requestId) => ({
  kind: "proposal",
  requestId,
  sessionId: "session-author",
  instruction: "근거를 한 문단으로 정리",
  target: { modelId: "local-document", epoch: 3, baseVersion: 7 },
  document: {
    format: "block-editor/v0.3",
    blocks: [
      {
        id: "source",
        type: "paragraph",
        attrs: {},
        content: [{ kind: "text", text: "원본", marks: [] }],
      },
    ],
  },
})

const owner = { subject: "author", authority: "demo-session" }

const deferred = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

it("executes a review candidate through the app-owned Part lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-lifecycle-"))
  roots.push(root)
  const fixture = createFixtureModel()
  const runtime = await createAgentRuntime({ root, model: fixture })

  const run = await runtime.start(input("request-tool"), {
    subject: "author",
    authority: "demo-session",
  })
  const completed = await runtime.wait(run.id)

  expect(completed.status).toBe("completed")
  expect(completed.candidate?.blocks.at(-1)?.content[0]).toMatchObject({
    kind: "text",
    text: "근거를 한 문단으로 정리",
  })
  expect(fixture.requests()).toHaveLength(2)
  expect(completed.events.some((event) => event.type === "tool.proposal")).toBe(true)
  await runtime.dispose()
})

it("deduplicates concurrent starts by principal, session, request, and input hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-start-receipt-"))
  roots.push(root)
  const fixture = createFixtureModel({ pause: true })
  const runtime = await createAgentRuntime({ root, model: fixture })

  const [first, retry] = await Promise.all([
    runtime.start(input("request-deduplicated"), owner),
    runtime.start(input("request-deduplicated"), owner),
  ])
  const reordered = input("request-deduplicated")
  const semanticRetry = await runtime.start(
    {
      document: reordered.document,
      target: reordered.target,
      instruction: reordered.instruction,
      sessionId: reordered.sessionId,
      requestId: reordered.requestId,
      kind: reordered.kind,
    },
    owner,
  )

  expect(retry.id).toBe(first.id)
  expect(semanticRetry.id).toBe(first.id)
  expect(first.inputHash).toMatch(/^[a-f0-9]{64}$/)
  expect(
    (await runtime.list()).filter((run) => run.input.requestId === "request-deduplicated"),
  ).toHaveLength(1)
  await expect(
    runtime.start({ ...input("request-deduplicated"), instruction: "다른 입력" }, owner),
  ).rejects.toBeInstanceOf(AgentRequestConflictError)
  await runtime.cancel(first.id, "test-cleanup", "cancel-cleanup")
  await runtime.wait(first.id)
  expect((await runtime.get(first.id))?.commandReceipts[0]?.inputHash).toMatch(/^[a-f0-9]{64}$/)
  await runtime.dispose()
  const restarted = await createAgentRuntime({ root, model: createFixtureModel() })
  const durableRetry = await restarted.start(input("request-deduplicated"), owner)
  expect(durableRetry.id).toBe(first.id)
  await expect(
    restarted.start(
      { ...input("request-deduplicated"), instruction: "재시작 후 다른 입력" },
      owner,
    ),
  ).rejects.toBeInstanceOf(AgentRequestConflictError)
  await restarted.dispose()
})

it("marks an active operation interrupted after an app restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-restart-"))
  roots.push(root)
  const runtime = await createAgentRuntime({ root, model: createFixtureModel({ pause: true }) })
  const started = await runtime.start(input("request-restart"), {
    subject: "author",
    authority: "demo-session",
  })

  await runtime.detach(started.id)
  await runtime.interruptForShutdown()
  const restarted = await createAgentRuntime({ root, model: createFixtureModel() })
  const recovered = await restarted.get(started.id)

  expect(recovered?.status).toBe("interrupted")
  expect(recovered?.events.at(-1)?.type).toBe("run.interrupted")
  await restarted.dispose()
})

it("keeps observer detach separate from explicit operation cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-cancel-"))
  roots.push(root)
  const runtime = await createAgentRuntime({ root, model: createFixtureModel({ pause: true }) })
  const started = await runtime.start(input("request-cancel"), {
    subject: "author",
    authority: "demo-session",
  })

  await runtime.detach(started.id)
  expect((await runtime.get(started.id))?.status).toBe("running")
  await runtime.cancel(started.id, "user-request")
  const cancelled = await runtime.wait(started.id)

  expect(cancelled.status).toBe("cancelled")
  expect(cancelled.cancellation).toBe("confirmed")
  await runtime.dispose()
})

it("keeps completed terminal state when cancellation arrives late", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-late-cancel-"))
  roots.push(root)
  const runtime = await createAgentRuntime({ root, model: createFixtureModel() })
  const started = await runtime.start(input("request-late-cancel"), owner)
  const completed = await runtime.wait(started.id)

  const first = await runtime.cancel(started.id, "too-late", "cancel-late")
  const retry = await runtime.cancel(started.id, "too-late", "cancel-late")

  expect(completed.status).toBe("completed")
  expect(first).toEqual(retry)
  expect((await runtime.get(started.id))?.status).toBe("completed")
  await expect(runtime.cancel(started.id, "changed", "cancel-late")).rejects.toBeInstanceOf(
    AgentCommandConflictError,
  )
  await runtime.dispose()
})

it("claims application once and returns the durable outcome to every retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-apply-receipt-"))
  roots.push(root)
  const barrier = deferred()
  const entered = deferred()
  let applications = 0
  const runtime = await createAgentRuntime({
    root,
    model: createFixtureModel(),
    async applyCandidate() {
      applications += 1
      entered.release()
      await barrier.promise
      return { kind: "applied", revision: 11 }
    },
  })
  const started = await runtime.start(input("request-apply-once"), owner)
  await runtime.wait(started.id)

  const first = runtime.apply(started.id, "author", "apply-once")
  const retry = runtime.apply(started.id, "author", "apply-once")
  const alternate = runtime.apply(started.id, "author", "apply-alternate")
  await entered.promise
  expect(applications).toBe(1)
  barrier.release()

  await expect(first).resolves.toEqual({ kind: "applied", revision: 11 })
  await expect(retry).resolves.toEqual({ kind: "applied", revision: 11 })
  await expect(alternate).resolves.toEqual({ kind: "applied", revision: 11 })
  expect((await runtime.get(started.id))?.application).toBe("applied")
  expect((await runtime.get(started.id))?.commandReceipts).toHaveLength(2)
  await runtime.dispose()
  const restarted = await createAgentRuntime({ root, model: createFixtureModel() })
  await expect(restarted.apply(started.id, "author", "apply-after-restart")).resolves.toEqual({
    kind: "applied",
    revision: 11,
  })
  await restarted.dispose()
})

it("persists an explicit non-retryable result when the apply adapter throws", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-apply-failure-"))
  roots.push(root)
  let applications = 0
  const runtime = await createAgentRuntime({
    root,
    model: createFixtureModel(),
    async applyCandidate() {
      applications += 1
      throw new TypeError("adapter failed after claim")
    },
  })
  const started = await runtime.start(input("request-apply-failure"), owner)
  await runtime.wait(started.id)

  const first = await runtime.apply(started.id, "author", "apply-failure")
  const retry = await runtime.apply(started.id, "author", "apply-failure-retry")

  expect(first).toEqual({ kind: "conflict", actualRevision: "application-failed" })
  expect(retry).toEqual(first)
  expect(applications).toBe(1)
  expect((await runtime.get(started.id))?.application).toBe("conflict")
  expect((await runtime.get(started.id))?.events.at(-1)?.type).toBe("candidate.apply-failed")
  await runtime.dispose()
})

it("contains observer failures without changing the Part terminal outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-observer-error-"))
  roots.push(root)
  const runtime = await createAgentRuntime({
    root,
    model: createFixtureModel(),
    observeOperation: async function* () {
      yield { kind: "data", index: 0, type: "test", payload: null }
      throw new Error("observer disconnected")
    },
  })

  const started = await runtime.start(input("request-observer-error"), owner)
  const completed = await runtime.wait(started.id)

  expect(completed.status).toBe("completed")
  expect(completed.events.some((event) => event.type === "observer.failed")).toBe(true)
  await runtime.dispose()
})

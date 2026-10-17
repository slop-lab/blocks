import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { createFixtureModel } from "../server/agent/model.mjs"
import { createAgentRuntime } from "../server/agent/runtime.mjs"

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

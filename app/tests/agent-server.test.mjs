import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { createFixtureModel } from "../server/agent/model.mjs"
import { createApplicationServer } from "../server/application.mjs"

let server
let root

afterEach(async () => {
  server?.closeAllConnections()
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

const open = async (model = createFixtureModel()) => {
  server = createApplicationServer({ runtimeRoot: root, agentModel: model })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing address")
  return `http://127.0.0.1:${address.port}`
}

const cookieFor = async (base, identity) => {
  const response = await fetch(`${base}/api/demo/session?identity=${identity}`, { method: "POST" })
  return response.headers.getSetCookie()[0]?.split(";", 1)[0]
}

const post = (base, cookie, path, body) =>
  fetch(`${base}/api/agent/${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json())

it("runs and queries a session-owned proposal through the same-origin Part bridge", async () => {
  root = await mkdtemp(join(tmpdir(), "agent-server-"))
  const base = await open()
  const cookie = await cookieFor(base, "author")
  const session = await post(base, cookie, "queries", {
    queryId: "block-editor.agent/session",
    version: 1,
    input: null,
  })
  const started = await post(base, cookie, "commands", {
    protocolVersion: 1,
    commandId: "agent-server-start",
    actionId: "block-editor.agent/start",
    actionVersion: 1,
    input: {
      kind: "proposal",
      requestId: "agent-server-request",
      sessionId: session.value.sessionId,
      instruction: "서버 후보",
      target: { modelId: "note", epoch: 1, baseVersion: 0 },
      document: { format: "block-editor/v0.3", blocks: [] },
    },
  })
  const retried = await post(base, cookie, "commands", {
    protocolVersion: 1,
    commandId: "agent-server-start-retry",
    actionId: "block-editor.agent/start",
    actionVersion: 1,
    input: {
      kind: "proposal",
      requestId: "agent-server-request",
      sessionId: session.value.sessionId,
      instruction: "서버 후보",
      target: { modelId: "note", epoch: 1, baseVersion: 0 },
      document: { format: "block-editor/v0.3", blocks: [] },
    },
  })
  const conflicting = await post(base, cookie, "commands", {
    protocolVersion: 1,
    commandId: "agent-server-start-conflict",
    actionId: "block-editor.agent/start",
    actionVersion: 1,
    input: {
      kind: "proposal",
      requestId: "agent-server-request",
      sessionId: session.value.sessionId,
      instruction: "다른 서버 후보",
      target: { modelId: "note", epoch: 1, baseVersion: 0 },
      document: { format: "block-editor/v0.3", blocks: [] },
    },
  })
  const completed = await post(base, cookie, "queries", {
    queryId: "block-editor.agent/get",
    version: 1,
    target: started.operation,
    input: null,
  })

  expect(started.kind).toBe("accepted")
  expect(retried.operation).toEqual(started.operation)
  expect(conflicting).toMatchObject({
    kind: "rejected",
    error: { code: "part.agent.request-reused" },
  })
  expect(completed.value).toMatchObject({
    provider: "fixture",
    providerLabel: "결정적 시나리오 / 모델미연결",
  })
})

it("rejects viewer admission and preserves an interrupted run across restart", async () => {
  root = await mkdtemp(join(tmpdir(), "agent-restart-"))
  const base = await open(createFixtureModel({ pause: true }))
  const viewer = await cookieFor(base, "viewer")
  const denied = await post(base, viewer, "queries", {
    queryId: "block-editor.agent/session",
    version: 1,
    input: null,
  })
  expect(denied.ok).toBe(false)

  const author = await cookieFor(base, "author")
  const initialized = await fetch(`${base}/api/ownership/mixed`, {
    headers: { cookie: author },
  })
  expect(initialized.status).toBe(200)
  const session = await post(base, author, "queries", {
    queryId: "block-editor.agent/session",
    version: 1,
    input: null,
  })
  const started = await post(base, author, "commands", {
    protocolVersion: 1,
    commandId: "agent-restart-start",
    actionId: "block-editor.agent/start",
    actionVersion: 1,
    input: {
      kind: "task",
      requestId: "agent-restart-request",
      sessionId: session.value.sessionId,
      instruction: "중단 보존",
      target: {
        modelId: "mixed-backlog",
        epoch: 1,
        baseVersion: 1,
        taskId: "TASK-104",
        dependencyVersion: 1,
      },
      document: { format: "block-editor/v0.3", blocks: [] },
    },
  })
  await new Promise((resolve) => server.close(resolve))
  const restartedBase = await open()
  const restartedAuthor = await cookieFor(restartedBase, "author")
  const recovered = await post(restartedBase, restartedAuthor, "queries", {
    queryId: "block-editor.agent/get",
    version: 1,
    target: started.operation,
    input: null,
  })

  expect(recovered.value.status).toBe("interrupted")
  expect(recovered.value.candidate).toBeNull()
  expect(recovered.value.artifact).toBeNull()
  expect(recovered.value.authority).toMatchObject({
    kind: "mixed-backlog",
    resourceId: "TASK-104",
    dependencyVersion: 1,
  })
})

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { createAgentEndpoint } from "../server/agent/endpoint.mjs"
import { createAgentHttpPort, startAgentHttpHost } from "../server/agent/http.mjs"
import { createFixtureModel } from "../server/agent/model.mjs"
import { createAgentRuntime } from "../server/agent/runtime.mjs"

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("serves session-owned Part command, query, and reconnectable watch contracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-http-"))
  roots.push(root)
  const runtime = await createAgentRuntime({ root, model: createFixtureModel() })
  const endpoint = createAgentEndpoint(runtime)
  const hosted = await startAgentHttpHost(endpoint, () => ({
    principal: { subject: "author", authority: "test" },
    sessionId: "session-http",
  }))
  if (!hosted.ok) throw new TypeError(hosted.error.message)
  const port = createAgentHttpPort(hosted.value.url)
  const watch = await port.watch({ surface: "agent-runs" })
  if (!watch.ok) throw new TypeError(watch.error.message)

  const delivery = await port.command({
    protocolVersion: 1,
    commandId: "command-http",
    actionId: "block-editor.agent/start",
    actionVersion: 1,
    input: {
      kind: "proposal",
      requestId: "request-http",
      sessionId: "session-http",
      instruction: "HTTP fixture candidate",
      target: { modelId: "document-http", epoch: 1, baseVersion: 2 },
      document: { format: "block-editor/v0.3", blocks: [] },
    },
  })
  expect(delivery.kind).toBe("receipt")
  if (delivery.kind !== "receipt" || delivery.receipt.kind !== "accepted")
    throw new TypeError("Agent command was not accepted")
  await runtime.wait(delivery.receipt.operation.id)
  const queried = await port.query({
    queryId: "block-editor.agent/get",
    version: 1,
    target: delivery.receipt.operation,
    input: null,
  })

  expect(queried.ok && queried.value).toMatchObject({ status: "completed", provider: "fixture" })
  await watch.value.close()
  const reconnected = await port.watch({
    surface: "agent-runs",
    resumeCursor: watch.value.bootstrap.cursor,
  })
  expect(reconnected.ok && reconnected.value.bootstrap.items).toHaveLength(1)
  if (reconnected.ok) await reconnected.value.close()
  await hosted.value.close()
  await endpoint.close()
})

it("isolates renewed sessions for the same principal across queries and watches", async () => {
  const root = await mkdtemp(join(tmpdir(), "part-agent-session-watch-"))
  roots.push(root)
  const runtime = await createAgentRuntime({ root, model: createFixtureModel() })
  const endpoint = createAgentEndpoint(runtime)
  const principal = { subject: "author", authority: "test" }
  const firstHost = await startAgentHttpHost(endpoint, () => ({
    principal,
    sessionId: "session-old",
  }))
  const renewedHost = await startAgentHttpHost(endpoint, () => ({
    principal,
    sessionId: "session-new",
  }))
  if (!firstHost.ok || !renewedHost.ok) throw new TypeError("Agent HTTP host failed")
  const first = createAgentHttpPort(firstHost.value.url)
  const renewed = createAgentHttpPort(renewedHost.value.url)
  const delivery = await first.command({
    protocolVersion: 1,
    commandId: "session-old-command",
    actionId: "block-editor.agent/start",
    actionVersion: 1,
    input: {
      kind: "proposal",
      requestId: "session-old-request",
      sessionId: "session-old",
      instruction: "Old session proposal",
      target: { modelId: "document-http", epoch: 1, baseVersion: 1 },
      document: { format: "block-editor/v0.3", blocks: [] },
    },
  })
  if (delivery.kind !== "receipt" || delivery.receipt.kind !== "accepted")
    throw new TypeError("Agent command was not accepted")
  await runtime.wait(delivery.receipt.operation.id)

  const denied = await renewed.query({
    queryId: "block-editor.agent/get",
    version: 1,
    target: delivery.receipt.operation,
    input: null,
  })
  const watch = await renewed.watch({ surface: "agent-runs" })

  expect(denied.ok).toBe(false)
  expect(watch.ok && watch.value.bootstrap.items).toHaveLength(0)
  if (watch.ok) await watch.value.close()
  await firstHost.value.close()
  await renewedHost.value.close()
  await endpoint.close()
})

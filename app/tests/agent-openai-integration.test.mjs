import { once } from "node:events"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { modelFromEnvironment } from "../server/agent/model.mjs"
import { createAgentRuntime } from "../server/agent/runtime.mjs"

const roots = []
const servers = []
const API_KEY = "integration-secret-do-not-log"

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const listen = async (handler) => {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing address")
  return `http://127.0.0.1:${address.port}/v1`
}

const modelFor = (baseUrl) =>
  modelFromEnvironment({
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: API_KEY,
    OPENAI_MODEL: "integration-model",
  })

const input = () => ({
  kind: "proposal",
  requestId: crypto.randomUUID(),
  sessionId: "integration-session",
  instruction: "Create the requested review candidate",
  target: { modelId: "client-draft", epoch: 1, baseVersion: 0 },
  document: { format: "block-editor/v0.3", blocks: [] },
})

const owner = { subject: "integration-author", authority: "integration-test" }

const sse = (response, value) => {
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(`data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n`)
}

const completion = (delta, finishReason) => ({
  id: crypto.randomUUID(),
  object: "chat.completion.chunk",
  created: 1,
  model: "integration-model",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
})

it("runs an authenticated SSE tool turn through the real Part transport", async () => {
  const requests = []
  const baseUrl = await listen(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    requests.push({ url: request.url, authorization: request.headers.authorization, body })
    if (requests.length === 1) {
      sse(
        response,
        completion(
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "candidate-call",
                type: "function",
                function: {
                  name: "candidate_patch",
                  arguments: JSON.stringify({ text: "network-created candidate" }),
                },
              },
            ],
          },
          "tool_calls",
        ),
      )
      return
    }
    sse(response, completion({ role: "assistant", content: "finished" }, "stop"))
  })
  const root = await mkdtemp(join(tmpdir(), "agent-openai-loop-"))
  roots.push(root)
  const runtime = await createAgentRuntime({ root, model: modelFor(baseUrl) })

  const started = await runtime.start(input(), owner)
  const completed = await runtime.wait(started.id)

  expect(requests).toHaveLength(2)
  expect(requests[0]).toMatchObject({
    url: "/v1/chat/completions",
    authorization: `Bearer ${API_KEY}`,
    body: { model: "integration-model", stream: true },
  })
  expect(requests[0].body.tools).toEqual([
    expect.objectContaining({
      type: "function",
      function: expect.objectContaining({ name: "candidate_patch" }),
    }),
  ])
  expect(requests[1].body.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }),
      expect.objectContaining({ role: "tool", tool_call_id: "candidate-call" }),
    ]),
  )
  expect(completed).toMatchObject({
    status: "completed",
    provider: "remote",
    providerLabel: "integration-model",
    application: "not-requested",
    artifact: null,
  })
  expect(completed.candidate?.blocks.at(-1)?.content[0]).toMatchObject({
    kind: "text",
    text: "network-created candidate",
  })
  await runtime.dispose()
})

it("records an HTTP authentication failure without retaining response secrets", async () => {
  const baseUrl = await listen(async (_request, response) => {
    response
      .writeHead(401, { "content-type": "application/json" })
      .end(JSON.stringify({ error: { message: `Bearer ${API_KEY}` } }))
  })
  const root = await mkdtemp(join(tmpdir(), "agent-openai-auth-"))
  roots.push(root)
  const runtime = await createAgentRuntime({ root, model: modelFor(baseUrl) })

  const started = await runtime.start(input(), owner)
  const failed = await runtime.wait(started.id)
  const journal = await readFile(join(root, "agent", "runs.json"), "utf8")

  expect(failed).toMatchObject({ status: "failed", error: "Provider returned HTTP 401" })
  expect(JSON.stringify(failed)).not.toContain(API_KEY)
  expect(journal).not.toContain(API_KEY)
  await runtime.dispose()
})

it("aborts an in-flight provider response when the run is cancelled", async () => {
  let releaseRequest
  const received = new Promise((resolve) => {
    releaseRequest = resolve
  })
  let releaseClose
  const closed = new Promise((resolve) => {
    releaseClose = resolve
  })
  const baseUrl = await listen(async (_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.flushHeaders()
    response.once("close", releaseClose)
    releaseRequest()
  })
  const root = await mkdtemp(join(tmpdir(), "agent-openai-cancel-"))
  roots.push(root)
  const runtime = await createAgentRuntime({ root, model: modelFor(baseUrl) })

  const started = await runtime.start(input(), owner)
  await received
  await runtime.cancel(started.id, "integration cancellation", "cancel-integration")
  const cancelled = await runtime.wait(started.id)
  await closed

  expect(cancelled).toMatchObject({ status: "cancelled", cancellation: "confirmed" })
  await runtime.dispose()
})

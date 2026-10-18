import { execFile } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { promisify } from "node:util"
import { afterEach, expect, it } from "vitest"

const run = promisify(execFile)
const servers = []
const script = new URL("../scripts/agent-check.mjs", import.meta.url)

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
})

const cleanEnvironment = () => {
  const environment = { ...process.env }
  for (const key of [
    "OPENAI_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "PART_API_BASE",
    "PART_API_KEY",
    "PART_MODEL_ID",
  ])
    delete environment[key]
  return environment
}

const execute = (arguments_, environment = cleanEnvironment()) =>
  run(process.execPath, [script.pathname, ...arguments_], { cwd: process.cwd(), env: environment })

const listen = async (handler) => {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing address")
  return `http://127.0.0.1:${address.port}/v1`
}

const completion = (delta, finishReason) => ({
  id: crypto.randomUUID(),
  object: "chat.completion.chunk",
  created: 1,
  model: "check-model",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
})

const sse = (response, value) => {
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(`data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n`)
}

it("prints help without provider configuration", async () => {
  const result = await execute(["--help"])

  expect(result.stdout).toContain("agent:check")
  expect(result.stdout).toContain("--timeout-ms")
  expect(result.stderr).toBe("")
})

it("fails clearly when provider configuration is absent", async () => {
  const failure = await execute([]).catch((error) => error)

  expect(failure.code).toBe(1)
  expect(failure.stderr).toContain("OPENAI_BASE_URL")
  expect(failure.stderr).not.toContain("undefined")
})

it("drives a real remote tool loop and prints metadata without content or secrets", async () => {
  const requests = []
  const baseUrl = await listen(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: [{ id: "check-model" }, { id: "selected-model" }] }))
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    if (requests.length === 1) {
      sse(
        response,
        completion(
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "check-call",
                type: "function",
                function: {
                  name: "candidate_patch",
                  arguments: JSON.stringify({ text: "private provider response" }),
                },
              },
            ],
          },
          "tool_calls",
        ),
      )
      return
    }
    sse(response, completion({ role: "assistant", content: "private completion" }, "stop"))
  })
  const apiKey = "check-secret-do-not-print"
  const result = await execute(["--model", "selected-model"], {
    ...cleanEnvironment(),
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: apiKey,
  })

  expect(requests).toHaveLength(2)
  expect(result.stdout).toContain("status: passed")
  expect(result.stdout).toContain("model: selected-model")
  expect(requests.every((request) => request.model === "selected-model")).toBe(true)
  expect(result.stdout).toContain("tool turns: 1")
  expect(result.stdout).not.toContain("private provider response")
  expect(result.stdout).not.toContain("private completion")
  expect(`${result.stdout}${result.stderr}`).not.toContain(apiKey)
})

it("cancels a provider request when the configured timeout expires", async () => {
  let releaseClose
  const closed = new Promise((resolve) => {
    releaseClose = resolve
  })
  const baseUrl = await listen(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: [{ id: "check-model" }] }))
      return
    }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.flushHeaders()
    response.once("close", releaseClose)
  })
  const apiKey = "timeout-secret-do-not-print"
  const failure = await execute(["--", "--timeout-ms", "50"], {
    ...cleanEnvironment(),
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: apiKey,
    OPENAI_MODEL: "check-model",
  }).catch((error) => error)
  await closed

  expect(failure.code).toBe(1)
  expect(failure.stderr).toContain("timed out after 50 ms")
  expect(failure.stderr).not.toContain(apiKey)
})

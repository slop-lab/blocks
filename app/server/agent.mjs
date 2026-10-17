import { createAgentEndpoint } from "./agent/endpoint.mjs"
import { startAgentHttpHost } from "./agent/http.mjs"
import { modelFromEnvironment } from "./agent/model.mjs"
import { createAgentRuntime } from "./agent/runtime.mjs"

const MAX_BODY_BYTES = 256 * 1024

const originAllowed = (request) => {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  if (host === undefined) return false
  return new URL(origin).host === host
}

const requestBody = async (request) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new RangeError("Agent request is too large")
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export const createAgentHandler = ({ root, host, environment = process.env, model }) => {
  const runtime = createAgentRuntime({ root, model: model ?? modelFromEnvironment(environment) })
  const endpoint = runtime.then(createAgentEndpoint)
  const hosted = endpoint.then((value) =>
    startAgentHttpHost(value, (request) => {
      const session = host.sessionFor(request)
      if (session === null) return null
      try {
        host.authority.require(session, "agent-runtime", "write")
        return {
          principal: { subject: session.subject, authority: session.issuer },
          sessionId: `${session.subject}:${session.expiresAt}`,
        }
      } catch {
        return null
      }
    }),
  )

  return {
    async handle(request, response) {
      const url = new URL(request.url ?? "/", "http://localhost")
      if (!url.pathname.startsWith("/api/agent/")) return false
      if (request.method !== "POST") {
        response
          .writeHead(405, { "content-type": "application/json" })
          .end('{"error":"method_not_allowed"}')
        return true
      }
      if (!originAllowed(request)) {
        response.writeHead(403, { "content-type": "application/json" }).end('{"error":"forbidden"}')
        return true
      }
      const path = url.pathname.slice("/api/agent/".length)
      if (!new Set(["commands", "queries", "events"]).has(path)) {
        response.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}')
        return true
      }
      const partHost = await hosted
      if (!partHost.ok) {
        response
          .writeHead(503, { "content-type": "application/json" })
          .end('{"error":"agent_unavailable"}')
        return true
      }
      const body = await requestBody(request)
      const controller = new AbortController()
      response.once("close", () => controller.abort())
      const upstream = await fetch(new URL(path, partHost.value.url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(request.headers.cookie === undefined ? {} : { cookie: request.headers.cookie }),
        },
        body,
        signal: controller.signal,
      })
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      })
      if (upstream.body === null) {
        response.end()
        return true
      }
      for await (const chunk of upstream.body) response.write(chunk)
      response.end()
      return true
    },
    async close() {
      const partHost = await hosted
      if (partHost.ok) await partHost.value.close()
      const value = await endpoint
      await value.close()
    },
  }
}

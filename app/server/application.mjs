import { createReadStream } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { FileRoomStore, resolveStaticApplication } from "@block-editor/server-bindings"
import { createAgentHandler } from "./agent.mjs"
import { attachCollaboration } from "./collaboration.mjs"
import { createHostDomain } from "./host-domain.mjs"
import { createLargeContentHandler } from "./large-content.mjs"
import { handleMarkdown } from "./markdown.mjs"
import { createOwnershipHandler } from "./ownership.mjs"
import { loadSessionSecret } from "./runtime-secret.mjs"
import { createWorkspaceHandler } from "./workspace.mjs"

const root = fileURLToPath(new URL("../../dist/", import.meta.url))
export const createApplicationServer = (options = {}) => {
  const runtimeRoot =
    options.runtimeRoot ?? fileURLToPath(new URL("../../.runtime/", import.meta.url))
  const sessionSecret = loadSessionSecret(runtimeRoot, options.sessionSecret)
  const host = createHostDomain({
    root: runtimeRoot,
    secret: sessionSecret,
    secureCookies: options.secureCookies === true,
  })
  const handleLargeContent = createLargeContentHandler({ root: join(runtimeRoot, "large-content") })
  const handleOwnership = createOwnershipHandler({ root: join(runtimeRoot, "ownership"), host })
  const handleWorkspace = createWorkspaceHandler({ root: join(runtimeRoot, "workspace"), host })
  const agent = createAgentHandler({
    root: runtimeRoot,
    host,
    environment: options.environment,
    model: options.agentModel,
  })
  const server = createServer(async (request, response) => {
    try {
      if (await host.handle(request, response)) return
      if (await handleMarkdown(request, response)) return
      if (await handleLargeContent(request, response)) return
      if (await handleOwnership(request, response)) return
      if (await handleWorkspace(request, response)) return
      if (await agent.handle(request, response)) return
      const url = new URL(request.url ?? "/", "http://localhost")
      if (url.pathname === "/api/notices/current" && request.method === "GET") {
        response
          .writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          })
          .end(
            JSON.stringify({
              id: "workshop-notice",
              revision: "1",
              text: "모임 안내: 토요일 오후 두 시에 작업실에서 만납니다. 개인 컵과 함께 읽을 책을 가져와 주세요.",
            }),
          )
        return
      }
      if (url.pathname.startsWith("/api/")) {
        response
          .writeHead(404, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "Not found" }))
        return
      }
      const asset = resolveStaticApplication({
        assetsRoot: root,
        method: request.method,
        requestUrl: request.url,
      })
      if (asset.kind === "unavailable") {
        response.writeHead(503).end("Build with corepack pnpm build first")
        return
      }
      const headers = {
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
      }
      if (host.sessionFor(request) === null)
        headers["set-cookie"] = host.cookie(
          host.issue(
            new URL(request.url ?? "/", "http://localhost").searchParams.get("identity") ??
              "author",
          ),
        )
      if (asset.kind === "no-content") {
        response.writeHead(204, headers).end()
        return
      }
      if (asset.kind === "not-found") {
        response
          .writeHead(404, {
            ...headers,
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          })
          .end(JSON.stringify({ error: "Not found" }))
        return
      }
      headers["content-type"] = asset.contentType
      headers["cache-control"] = asset.cacheControl
      response.writeHead(200, headers)
      if (request.method === "HEAD") {
        response.end()
        return
      }
      const stream = createReadStream(asset.path)
      stream.on("error", () => response.destroy())
      stream.pipe(response)
    } catch (error) {
      if (response.headersSent) {
        response.destroy()
        return
      }
      const badRequest = error instanceof URIError || error instanceof SyntaxError
      response.writeHead(badRequest ? 400 : 500, { "content-type": "application/json" }).end(
        JSON.stringify({
          error: badRequest ? "Invalid request" : "The operation could not be completed",
        }),
      )
    }
  })
  const collaboration = attachCollaboration(server, {
    store: new FileRoomStore({ root: join(runtimeRoot, "collaboration") }),
    authorize: (request, room, operation) => {
      const session = host.sessionFor(request)
      if (session === null) return false
      try {
        host.authority.require(session, room, operation)
        return true
      } catch {
        return false
      }
    },
  })
  const closeServer = server.close.bind(server)
  server.close = (callback) => {
    Promise.all([collaboration.flushPersistence(), agent.close()]).then(
      () => closeServer(callback),
      (error) => callback?.(error),
    )
    return server
  }
  server.on("close", () => {
    for (const client of collaboration.clients) client.terminate()
    collaboration.close()
  })
  return server
}

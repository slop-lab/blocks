import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { FileRoomStore } from "@block-editor/server-bindings"
import { attachCollaboration } from "./collaboration.mjs"
import { createHostDomain } from "./host-domain.mjs"
import { handleLargeContent } from "./large-content.mjs"
import { handleMarkdown } from "./markdown.mjs"

const root = fileURLToPath(new URL("../../dist/", import.meta.url))
const contentTypes = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
}

export const createApplicationServer = (options = {}) => {
  const runtimeRoot = options.runtimeRoot ?? fileURLToPath(new URL("../../.runtime/", import.meta.url))
  const sessionSecret = options.sessionSecret ?? process.env.DEMO_SESSION_SECRET ?? "local-demo-session-secret-change-me"
  const host = createHostDomain({ root: runtimeRoot, secret: sessionSecret })
  const server = createServer(async (request, response) => {
    try {
      if (await host.handle(request, response)) return
      if (await handleMarkdown(request, response)) return
      if (await handleLargeContent(request, response)) return
      const url = new URL(request.url ?? "/", "http://localhost")
      if (url.pathname === "/api/notices/current" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
          .end(JSON.stringify({ id: "workshop-notice", revision: "1", text: "모임 안내: 토요일 오후 두 시에 작업실에서 만납니다. 개인 컵과 함께 읽을 책을 가져와 주세요." }))
        return
      }
      if (url.pathname.startsWith("/api/")) {
        response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not found" }))
        return
      }
      const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "")
      const candidate = join(root, requested)
      const path = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html")
      if (!existsSync(path)) { response.writeHead(503).end("Build with corepack pnpm build first"); return }
      const extension = extname(path)
      const headers = {
        "content-type": contentTypes[extension] ?? "application/octet-stream",
        "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
      }
      if (host.sessionFor(request) === null) headers["set-cookie"] = host.cookie(host.issue(new URL(request.url ?? "/", "http://localhost").searchParams.get("identity") ?? "author"))
      response.writeHead(200, headers)
      const stream = createReadStream(path)
      stream.on("error", () => response.destroy())
      stream.pipe(response)
    } catch (error) {
      if (response.headersSent) { response.destroy(); return }
      const badRequest = error instanceof URIError || error instanceof SyntaxError
      response.writeHead(badRequest ? 400 : 500, { "content-type": "application/json" })
        .end(JSON.stringify({ error: badRequest ? "Invalid request" : "The operation could not be completed" }))
    }
  })
  const collaboration = attachCollaboration(server, {
    store: new FileRoomStore({ root: join(runtimeRoot, "collaboration") }),
    authorize: (request, room, operation) => {
      const session = host.sessionFor(request)
      if (session === null) return false
      try { host.authority.require(session, room, operation); return true } catch { return false }
    },
  })
  server.on("close", () => {
    for (const client of collaboration.clients) client.terminate()
    collaboration.close()
  })
  return server
}

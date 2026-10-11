import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { createGitDocumentsHandler, type GitDocumentsHandlerOptions } from "./handler.js"
import { json } from "./http.js"

type ServerOptions = GitDocumentsHandlerOptions & { readonly assetsRoot?: string }

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
}

export const createGitDocumentsServer = (options: ServerOptions): Server => {
  const handle = createGitDocumentsHandler(options)
  return createServer(async (request, response) => {
    try {
      if (await handle(request, response)) return
      if (options.assetsRoot === undefined) {
        json(response, 404, { error: "not_found" })
        return
      }
      const assetsRoot = resolve(options.assetsRoot)
      const url = new URL(request.url ?? "/", "http://localhost")
      const requested = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/u, "")
      const candidate = resolve(join(assetsRoot, requested))
      const safeCandidate = candidate.startsWith(`${assetsRoot}/`)
        ? candidate
        : join(assetsRoot, "index.html")
      const path =
        existsSync(safeCandidate) && statSync(safeCandidate).isFile()
          ? safeCandidate
          : join(assetsRoot, "index.html")
      if (!existsSync(path)) {
        response.writeHead(503).end("Build the browser application first")
        return
      }
      const extension = extname(path)
      response.writeHead(200, {
        "content-type": contentTypes[extension] ?? "application/octet-stream",
        "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      })
      createReadStream(path).pipe(response)
    } catch (error) {
      if (!response.headersSent)
        json(response, error instanceof URIError ? 400 : 500, { error: "operation_failed" })
      else response.destroy()
    }
  })
}

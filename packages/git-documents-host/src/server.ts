import { createReadStream } from "node:fs"
import { createServer, type Server } from "node:http"
import { resolveStaticApplication } from "@slop-lab/blocks-server-bindings"
import { createGitDocumentsHandler, type GitDocumentsHandlerOptions } from "./handler.js"
import { json } from "./http.js"

type ServerOptions = GitDocumentsHandlerOptions & { readonly assetsRoot?: string }

export const createGitDocumentsServer = (options: ServerOptions): Server => {
  const handle = createGitDocumentsHandler(options)
  return createServer(async (request, response) => {
    try {
      if (await handle(request, response)) return
      if (options.assetsRoot === undefined) {
        json(response, 404, { error: "not_found" })
        return
      }
      const asset = resolveStaticApplication({
        assetsRoot: options.assetsRoot,
        method: request.method,
        requestUrl: request.url,
      })
      if (asset.kind === "unavailable") {
        response.writeHead(503).end("Build the browser application first")
        return
      }
      if (asset.kind === "no-content") {
        response.writeHead(204).end()
        return
      }
      if (asset.kind === "not-found") {
        json(response, 404, { error: "not_found" })
        return
      }
      response.writeHead(200, {
        "content-type": asset.contentType,
        "cache-control": asset.cacheControl,
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      })
      if (request.method === "HEAD") response.end()
      else createReadStream(asset.path).pipe(response)
    } catch (error) {
      if (!response.headersSent)
        json(response, error instanceof URIError ? 400 : 500, { error: "operation_failed" })
      else response.destroy()
    }
  })
}

import type { IncomingMessage, ServerResponse } from "node:http"
import { basename } from "node:path"
import { GitDocuments } from "@block-editor/git-documents"
import { body, HttpBoundaryError, json, sameOrigin, sendError } from "./http.js"
import {
  branchSchema,
  commitSchema,
  createSchema,
  deleteSchema,
  draftSchema,
  fileWriteSchema,
  mergeSchema,
  renameSchema,
  restoreSchema,
} from "./schemas.js"

export type GitDocumentsHandlerOptions = { readonly documents: GitDocuments }

export const createGitDocumentsHandler = (options: GitDocumentsHandlerOptions) => {
  let documents = options.documents
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (!url.pathname.startsWith("/api/git-documents")) return false
    try {
      if (request.method !== "GET" && !sameOrigin(request)) {
        json(response, 403, {
          error: "origin_denied",
          message: "Mutation origin does not match host",
        })
        return true
      }
      const route = url.pathname.slice("/api/git-documents".length) || "/"
      if (request.method === "GET" && route === "/") {
        json(response, 200, {
          repository: basename(documents.repo),
          branch: documents.branch,
          docs: documents.docs,
          tree: await documents.listDocuments(),
          changes: await documents.status(),
          remote: await documents.remoteStatus(),
        })
      } else if (request.method === "GET" && route === "/file") {
        json(response, 200, await documents.readDocument(required(url, "path")))
      } else if (request.method === "GET" && route === "/diff") {
        json(response, 200, await documents.diff(required(url, "path")))
      } else if (request.method === "GET" && route === "/history") {
        json(response, 200, { entries: await documents.history(required(url, "path")) })
      } else if (request.method === "GET" && route === "/search") {
        json(response, 200, { results: await documents.search(required(url, "q")) })
      } else if (request.method === "GET" && route === "/backlinks") {
        json(response, 200, { results: await documents.backlinks(required(url, "path")) })
      } else if (request.method === "GET" && route === "/branches") {
        json(response, 200, { branches: await documents.branches() })
      } else if (request.method === "GET" && route === "/remote") {
        json(response, 200, await documents.remoteStatus())
      } else if (request.method === "POST" && route === "/documents") {
        const input = createSchema.parse(await body(request))
        json(response, 201, await documents.createDocument(input.path, input.content))
      } else if (request.method === "PUT" && route === "/file") {
        const input = fileWriteSchema.parse(await body(request))
        json(
          response,
          200,
          await documents.writeDocument(input.path, input.content, input.expectedRevision),
        )
      } else if (request.method === "PUT" && route === "/draft") {
        const input = draftSchema.parse(await body(request))
        json(
          response,
          200,
          await documents.saveDraft(input.path, input.content, input.baseRevision),
        )
      } else if (request.method === "DELETE" && route === "/draft") {
        const input = deleteSchema.pick({ path: true }).parse(await body(request))
        await documents.clearDraft(input.path)
        json(response, 200, { cleared: true })
      } else if (request.method === "POST" && route === "/rename") {
        const input = renameSchema.parse(await body(request))
        json(response, 200, await documents.renameDocument(input.from, input.to))
      } else if (request.method === "POST" && route === "/delete") {
        const input = deleteSchema.parse(await body(request))
        await documents.deleteDocument(input.path, input.expectedRevision)
        json(response, 200, { deleted: true })
      } else if (request.method === "POST" && route === "/commit") {
        const input = commitSchema.parse(await body(request))
        json(response, 200, await documents.commit(input.paths, input.message))
      } else if (request.method === "POST" && route === "/restore") {
        const input = restoreSchema.parse(await body(request))
        json(response, 200, await documents.restoreDocument(input.path, input.commit))
      } else if (request.method === "POST" && route === "/branches") {
        const input = branchSchema.parse(await body(request))
        documents = await documents.createBranch(input.branch)
        json(response, 201, { branch: documents.branch })
      } else if (request.method === "POST" && route === "/branch/switch") {
        const input = branchSchema.parse(await body(request))
        documents = await GitDocuments.open({
          repo: documents.repo,
          data: documents.data,
          docs: documents.docs,
          branch: input.branch,
        })
        json(response, 200, { branch: documents.branch })
      } else if (request.method === "POST" && route === "/remote/fetch") {
        await documents.fetch()
        json(response, 200, await documents.remoteStatus())
      } else if (request.method === "POST" && route === "/remote/fast-forward") {
        json(response, 200, await documents.fastForward())
      } else if (request.method === "POST" && route === "/remote/push") {
        json(response, 200, await documents.push())
      } else if (request.method === "POST" && route === "/remote/merge") {
        json(response, 200, await documents.prepareMerge())
      } else if (request.method === "POST" && route === "/remote/resolve") {
        const input = fileWriteSchema.parse(await body(request))
        json(
          response,
          200,
          await documents.resolveConflict(input.path, input.content, input.expectedRevision),
        )
      } else if (request.method === "POST" && route === "/remote/complete") {
        const input = mergeSchema.parse(await body(request))
        json(response, 200, await documents.completeMerge(input.message))
      } else if (request.method === "POST" && route === "/remote/abort") {
        await documents.abortMerge()
        json(response, 200, { aborted: true })
      } else {
        json(response, 404, { error: "not_found", message: "Route does not exist" })
      }
    } catch (error) {
      sendError(response, error)
    }
    return true
  }
}

const required = (url: URL, name: string): string => {
  const value = url.searchParams.get(name)
  if (value === null) throw new HttpBoundaryError(400, `Missing ${name} parameter`)
  return value
}

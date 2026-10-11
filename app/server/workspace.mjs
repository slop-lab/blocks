import { join } from "node:path"
import { FileCasRepository, RevisionConflictError } from "@block-editor/server-bindings"
import {
  createPage,
  databaseSchema,
  pageDocumentSchema,
  pageSchema,
  syncedSourceSchema,
  workspaceSchema,
} from "@block-editor/workspace"
import { z } from "zod"
import {
  sampleDatabases,
  sampleDocuments,
  sampleSources,
  sampleWorkspace,
} from "./workspace-seed.mjs"
import { validateWorkspaceEntity } from "./workspace-validation.mjs"

const MAX_BODY = 512 * 1024
const updateSchema = z
  .object({ expectedRevision: z.number().int().positive().optional(), content: z.json() })
  .strict()
const createPageSchema = z
  .object({
    expectedTreeRevision: z.number().int().positive(),
    page: pageSchema.omit({ archived: true }),
  })
  .strict()

const send = (response, status, payload) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  response.end(JSON.stringify(payload))
}
const readBody = async (request) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new RangeError("Request body is too large")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}
const createIfMissing = async (repository, documentId, content) => {
  const existing = await repository.read(documentId)
  if (existing !== null) return existing
  try {
    return await repository.create({ documentId, content, actorId: "sample" })
  } catch (error) {
    if (!(error instanceof RevisionConflictError)) throw error
    return repository.read(documentId)
  }
}

export const createWorkspaceHandler = ({ root, host }) => {
  const repositories = {
    trees: new FileCasRepository({ root: join(root, "trees") }),
    pages: new FileCasRepository({ root: join(root, "pages") }),
    databases: new FileCasRepository({ root: join(root, "databases") }),
    sources: new FileCasRepository({ root: join(root, "sources") }),
  }
  const initialize = async () => {
    const tree = await createIfMissing(
      repositories.trees,
      sampleWorkspace.id,
      workspaceSchema.parse(sampleWorkspace),
    )
    const pageRecords = await Promise.all(
      sampleDocuments.map((value) =>
        createIfMissing(repositories.pages, value.pageId, pageDocumentSchema.parse(value)),
      ),
    )
    const databaseRecords = await Promise.all(
      sampleDatabases.map((value) =>
        createIfMissing(repositories.databases, value.id, databaseSchema.parse(value)),
      ),
    )
    const sourceRecords = await Promise.all(
      sampleSources.map((value) =>
        createIfMissing(repositories.sources, value.id, syncedSourceSchema.parse(value)),
      ),
    )
    await Promise.all([pageRecords, databaseRecords, sourceRecords])
    const [documents, databases, sources] = await Promise.all([
      repositories.pages.list(),
      repositories.databases.list(),
      repositories.sources.list(),
    ])
    return { tree, documents, databases, sources }
  }
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (!url.pathname.startsWith("/api/workspace")) return false
    const session = host.sessionFor(request)
    if (session === null) {
      send(response, 401, { error: "session_required" })
      return true
    }
    try {
      host.authority.require(
        session,
        "structured-workspace",
        request.method === "GET" ? "read" : "write",
      )
      if (url.pathname === "/api/workspace" && request.method === "GET") {
        send(response, 200, await initialize())
        return true
      }
      if (url.pathname === "/api/workspace/pages" && request.method === "POST") {
        const origin = request.headers.origin
        if (origin !== undefined && new URL(origin).host !== request.headers.host) {
          send(response, 403, { error: "cross_origin_mutation" })
          return true
        }
        await initialize()
        const parsed = createPageSchema.parse(await readBody(request))
        const tree = await repositories.trees.read(sampleWorkspace.id)
        if (tree === null) throw new TypeError("Workspace tree is missing")
        const pageDocument = pageDocumentSchema.parse({
          pageId: parsed.page.id,
          version: 1,
          blocks: [
            { id: `${parsed.page.id}-heading`, type: "heading", level: 1, text: parsed.page.title },
            { id: `${parsed.page.id}-paragraph`, type: "paragraph", text: "" },
          ],
        })
        const document = await repositories.pages.create({
          documentId: parsed.page.id,
          content: pageDocument,
          actorId: session.subject,
        })
        try {
          const content = createPage(tree.content, parsed.page)
          const savedTree = await repositories.trees.update(
            tree.documentId,
            parsed.expectedTreeRevision,
            { ...content, version: content.version + 1 },
            { actorId: session.subject },
          )
          send(response, 201, { tree: savedTree, document })
        } catch (error) {
          await repositories.pages.delete(document.documentId, document.revision)
          throw error
        }
        return true
      }
      const match = /^\/api\/workspace\/(trees|pages|databases|sources)\/([a-zA-Z0-9_-]+)$/u.exec(
        url.pathname,
      )
      if (match === null) {
        send(response, 404, { error: "not_found" })
        return true
      }
      if (request.method !== "PUT") {
        send(response, 405, { error: "method_not_allowed" })
        return true
      }
      const origin = request.headers.origin
      if (origin !== undefined && new URL(origin).host !== request.headers.host) {
        send(response, 403, { error: "cross_origin_mutation" })
        return true
      }
      const [, kind, id] = match
      const parsed = updateSchema.parse(await readBody(request))
      const schemas = {
        trees: workspaceSchema,
        pages: pageDocumentSchema,
        databases: databaseSchema,
        sources: syncedSourceSchema,
      }
      const content = schemas[kind].parse(parsed.content)
      await validateWorkspaceEntity({ kind, id, content, repositories })
      const current = await repositories[kind].read(id)
      if (parsed.expectedRevision === undefined && current !== null) {
        send(response, 400, { error: "expected_revision_required" })
        return true
      }
      const saved =
        parsed.expectedRevision === undefined
          ? await repositories[kind].create({ documentId: id, content, actorId: session.subject })
          : await repositories[kind].update(id, parsed.expectedRevision, content, {
              actorId: session.subject,
            })
      send(response, current === null ? 201 : 200, saved)
      return true
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        send(response, 409, { error: "stale_revision", actualRevision: error.actual })
        return true
      }
      if (
        error instanceof z.ZodError ||
        error instanceof SyntaxError ||
        error instanceof RangeError ||
        error instanceof TypeError
      ) {
        send(response, error instanceof RangeError ? 413 : 400, { error: "invalid_request" })
        return true
      }
      if (error instanceof Error && error.name === "AccessDeniedError") {
        send(response, 403, { error: "forbidden" })
        return true
      }
      throw error
    }
  }
}

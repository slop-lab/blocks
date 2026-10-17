import { join } from "node:path"
import { FileCasRepository, RevisionConflictError } from "@slop-lab/blocks-server-bindings"
import {
  createPage,
  databaseSchema,
  pageDocumentSchema,
  syncedSourceSchema,
  workspaceSchema,
} from "@slop-lab/blocks-workspace"
import { z } from "zod"
import { withWorkspaceMutation } from "./workspace-mutation-queue.mjs"
import {
  createPageSchema,
  readWorkspaceBody,
  sendWorkspaceResponse,
  updateSchema,
} from "./workspace-request.mjs"
import {
  sampleDatabases,
  sampleDocuments,
  sampleSources,
  sampleWorkspace,
} from "./workspace-seed.mjs"
import { validateWorkspaceCandidates, validateWorkspaceEntity } from "./workspace-validation.mjs"

const send = sendWorkspaceResponse
const createIfMissing = async (repository, documentId, content, schema) => {
  const existing = await repository.read(documentId)
  if (existing !== null) {
    const migrated = schema.parse(existing.content)
    if (JSON.stringify(migrated) === JSON.stringify(existing.content)) return existing
    return repository.update(documentId, existing.revision, migrated, {
      actorId: "schema-migration",
    })
  }
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
      workspaceSchema,
    )
    const pageRecords = await Promise.all(
      sampleDocuments.map((value) =>
        createIfMissing(
          repositories.pages,
          value.pageId,
          pageDocumentSchema.parse(value),
          pageDocumentSchema,
        ),
      ),
    )
    const databaseRecords = await Promise.all(
      sampleDatabases.map((value) =>
        createIfMissing(
          repositories.databases,
          value.id,
          databaseSchema.parse(value),
          databaseSchema,
        ),
      ),
    )
    const sourceRecords = await Promise.all(
      sampleSources.map((value) =>
        createIfMissing(
          repositories.sources,
          value.id,
          syncedSourceSchema.parse(value),
          syncedSourceSchema,
        ),
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
        send(response, 200, await withWorkspaceMutation(root, initialize))
        return true
      }
      if (url.pathname === "/api/workspace/pages" && request.method === "POST") {
        const origin = request.headers.origin
        if (origin !== undefined && new URL(origin).host !== request.headers.host) {
          send(response, 403, { error: "cross_origin_mutation" })
          return true
        }
        const parsed = createPageSchema.parse(await readWorkspaceBody(request))
        const created = await withWorkspaceMutation(root, async () => {
          await initialize()
          const tree = await repositories.trees.read(sampleWorkspace.id)
          if (tree === null) throw new TypeError("Workspace tree is missing")
          const pageDocument = pageDocumentSchema.parse({
            pageId: parsed.page.id,
            version: 1,
            blocks: [
              {
                id: `${parsed.page.id}-section`,
                type: "section",
                heading: parsed.page.title,
                children: [{ id: `${parsed.page.id}-paragraph`, type: "paragraph", text: "" }],
              },
            ],
          })
          const content = createPage(tree.content, parsed.page)
          const nextTree = { ...content, version: content.version + 1 }
          await validateWorkspaceCandidates({
            candidates: [
              { kind: "trees", id: tree.documentId, content: nextTree },
              { kind: "pages", id: parsed.page.id, content: pageDocument },
            ],
            repositories,
          })
          const document = await repositories.pages.create({
            documentId: parsed.page.id,
            content: pageDocument,
            actorId: session.subject,
          })
          try {
            const savedTree = await repositories.trees.update(
              tree.documentId,
              parsed.expectedTreeRevision,
              nextTree,
              { actorId: session.subject },
            )
            return { tree: savedTree, document }
          } catch (error) {
            await repositories.pages.delete(document.documentId, document.revision)
            throw error
          }
        })
        send(response, 201, created)
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
      const parsed = updateSchema.parse(await readWorkspaceBody(request))
      const schemas = {
        trees: workspaceSchema,
        pages: pageDocumentSchema,
        databases: databaseSchema,
        sources: syncedSourceSchema,
      }
      const content = schemas[kind].parse(parsed.content)
      const result = await withWorkspaceMutation(root, async () => {
        await initialize()
        const current = await repositories[kind].read(id)
        if (parsed.expectedRevision === undefined && current !== null)
          return { kind: "expected_revision_required" }
        await validateWorkspaceEntity({ kind, id, content, repositories })
        const saved =
          parsed.expectedRevision === undefined
            ? await repositories[kind].create({ documentId: id, content, actorId: session.subject })
            : await repositories[kind].update(id, parsed.expectedRevision, content, {
                actorId: session.subject,
              })
        return { kind: "saved", saved, created: current === null }
      })
      if (result.kind === "expected_revision_required") {
        send(response, 400, { error: "expected_revision_required" })
        return true
      }
      send(response, result.created ? 201 : 200, result.saved)
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

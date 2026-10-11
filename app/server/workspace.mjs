import { join } from "node:path"
import { FileCasRepository, RevisionConflictError } from "@block-editor/server-bindings"
import {
  databaseSchema,
  pageDocumentSchema,
  syncedSourceSchema,
  workspaceSchema,
} from "@block-editor/workspace"
import { z } from "zod"

const MAX_BODY = 512 * 1024
const updateSchema = z
  .object({ expectedRevision: z.number().int().positive().optional(), content: z.json() })
  .strict()
const sampleWorkspace = {
  id: "structured-workspace",
  version: 1,
  pages: [
    { id: "home", parentId: null, title: "팀 홈", icon: "note", archived: false },
    { id: "project", parentId: "home", title: "제품 출시", icon: "file", archived: false },
    { id: "research", parentId: "project", title: "사용자 조사", icon: "file", archived: false },
  ],
}
const documents = [
  {
    pageId: "home",
    version: 1,
    blocks: [
      { id: "home-h", type: "heading", level: 1, text: "팀 지식 작업실" },
      {
        id: "home-p",
        type: "paragraph",
        text: "문서, 데이터베이스, 공유 블록을 한곳에서 관리합니다.",
      },
      { id: "home-link", type: "page_ref", pageId: "project" },
    ],
  },
  {
    pageId: "project",
    version: 1,
    blocks: [
      { id: "project-h", type: "heading", level: 1, text: "제품 출시" },
      {
        id: "project-shared-a",
        type: "synced_ref",
        occurrenceId: "occ-a",
        sourceId: "launch-note",
      },
      { id: "project-db", type: "database_embed", databaseId: "tasks", layout: "table" },
      {
        id: "project-shared-b",
        type: "synced_ref",
        occurrenceId: "occ-b",
        sourceId: "launch-note",
      },
    ],
  },
  {
    pageId: "research",
    version: 1,
    blocks: [
      { id: "research-h", type: "heading", level: 2, text: "조사 메모" },
      { id: "research-q", type: "quote", text: "문맥은 이동해도 제목의 상대 수준은 보존됩니다." },
    ],
  },
]
const databases = [
  {
    id: "tasks",
    version: 1,
    name: "출시 작업",
    properties: [
      { id: "name", name: "작업", type: "text" },
      { id: "status", name: "상태", type: "status", options: ["대기", "진행", "완료"] },
      { id: "owner", name: "담당", type: "text" },
      { id: "done", name: "완료", type: "checkbox" },
    ],
    rows: [
      { id: "task-1", values: { name: "출시 노트", status: "진행", owner: "민서", done: false } },
      { id: "task-2", values: { name: "품질 확인", status: "대기", owner: "도윤", done: false } },
      { id: "task-3", values: { name: "인터뷰 정리", status: "완료", owner: "서연", done: true } },
    ],
  },
]
const sources = [
  {
    id: "launch-note",
    version: 1,
    blocks: [
      {
        id: "shared-p",
        type: "paragraph",
        text: "공유 출시 메모입니다. 한 번 수정하면 모든 위치에 반영됩니다.",
      },
    ],
  },
]

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
      documents.map((value) =>
        createIfMissing(repositories.pages, value.pageId, pageDocumentSchema.parse(value)),
      ),
    )
    const databaseRecords = await Promise.all(
      databases.map((value) =>
        createIfMissing(repositories.databases, value.id, databaseSchema.parse(value)),
      ),
    )
    const sourceRecords = await Promise.all(
      sources.map((value) =>
        createIfMissing(repositories.sources, value.id, syncedSourceSchema.parse(value)),
      ),
    )
    return { tree, documents: pageRecords, databases: databaseRecords, sources: sourceRecords }
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
        error instanceof RangeError
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

import { join } from "node:path"
import {
  AccessDeniedError,
  DemoSessionAuthority,
  FileCasRepository,
  RevisionConflictError,
  WorkflowRepository,
  WorkflowStateError,
} from "@block-editor/server-bindings"

const identities = {
  author: { subject: "author", role: "editor", rooms: ["*"] },
  reviewer: { subject: "reviewer", role: "owner", rooms: ["*"] },
  viewer: { subject: "viewer", role: "viewer", rooms: ["team-minutes", "large-content"] },
}

const cookieValue = (request) => {
  const cookie = request.headers.cookie ?? ""
  const pair = cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith("demo_session="))
  return pair?.slice("demo_session=".length) ?? null
}

const send = (response, status, value, headers = {}) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  })
  response.end(JSON.stringify(value))
}

const readJson = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export const createHostDomain = ({ root, secret }) => {
  const authority = new DemoSessionAuthority({ secret, issuer: "block-editor-demo" })
  const documents = new FileCasRepository({ root: join(root, "documents") })
  const workflows = new WorkflowRepository({ root: join(root, "workflows") })
  const sessionFor = (request) => {
    const token = cookieValue(request)
    return token === null ? null : authority.verify(token)
  }
  const issue = (identity) => {
    const selected = identities[identity] ?? identities.author
    return authority.issue(selected)
  }
  const cookie = (token) => `demo_session=${token}; Path=/; HttpOnly; SameSite=Lax`

  const handle = async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (url.pathname === "/api/demo/session" && request.method === "POST") {
      const identity = url.searchParams.get("identity") ?? "author"
      if (!(identity in identities)) { send(response, 400, { error: "Unknown demo identity" }); return true }
      const token = issue(identity)
      send(response, 200, { identity, role: identities[identity].role }, { "set-cookie": cookie(token) })
      return true
    }
    const documentMatch = /^\/api\/documents\/([a-zA-Z0-9_-]+)$/.exec(url.pathname)
    const workflowReadMatch = /^\/api\/workflows\/([a-zA-Z0-9_-]+)$/.exec(url.pathname)
    const workflowMatch = /^\/api\/workflows\/([a-zA-Z0-9_-]+)\/(submit|approve)$/.exec(url.pathname)
    if (documentMatch === null && workflowReadMatch === null && workflowMatch === null) return false
    try {
      const session = sessionFor(request)
      if (session === null) { send(response, 401, { error: "Demo session required" }); return true }
      if (documentMatch !== null) {
        const documentId = documentMatch[1]
        authority.require(session, documentId, request.method === "GET" ? "read" : "write")
        if (request.method === "GET") {
          const record = await documents.read(documentId)
          send(response, record === null ? 404 : 200, record ?? { error: "Document not found" })
          return true
        }
        if (request.method !== "PUT") { send(response, 405, { error: "Method not allowed" }); return true }
        const body = await readJson(request)
        const current = await documents.read(documentId)
        const record = current === null
          ? await documents.create({ documentId, content: body.content, metadata: body.metadata ?? {}, actorId: session.subject })
          : await documents.update(documentId, body.expectedRevision, body.content, { actorId: session.subject })
        if ((await workflows.read(documentId)) === null) await workflows.create(documentId, session.subject)
        send(response, current === null ? 201 : 200, record)
        return true
      }
      if (workflowReadMatch !== null) {
        const documentId = workflowReadMatch[1]
        authority.require(session, documentId, "read")
        const record = await workflows.read(documentId)
        send(response, record === null ? 404 : 200, record ?? { error: "Workflow not found" })
        return true
      }
      const documentId = workflowMatch[1]
      const action = workflowMatch[2]
      authority.require(session, documentId, action === "approve" ? "approve" : "write")
      const body = await readJson(request)
      const record = action === "approve"
        ? await workflows.approve(documentId, body.expectedRevision, session.subject)
        : await workflows.submit(documentId, body.expectedRevision, session.subject)
      send(response, 200, record)
      return true
    } catch (error) {
      if (error instanceof AccessDeniedError) { send(response, 403, { error: error.message }); return true }
      if (error instanceof RevisionConflictError) { send(response, 409, { error: error.message, actualRevision: error.actual }); return true }
      if (error instanceof WorkflowStateError) { send(response, 409, { error: error.message }); return true }
      if (error instanceof SyntaxError || error instanceof TypeError) { send(response, 400, { error: error.message }); return true }
      throw error
    }
  }
  return { authority, cookie, handle, issue, sessionFor }
}

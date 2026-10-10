import { FileCasRepository, RevisionConflictError } from "@block-editor/server-bindings"
import { z } from "zod"

const taskSchema = z.object({ id: z.string(), title: z.string(), status: z.enum(["backlog", "running", "done"]), version: z.number().int().positive() })
const proposalSchema = z.object({ id: z.string(), taskId: z.string(), draft: z.string(), dependencyVersion: z.number().int().positive() })
const mixedSchema = z.object({
  tasks: z.array(taskSchema),
  presentation: z.record(z.string(), z.string()),
  proposals: z.array(proposalSchema),
  taskInfoFile: z.string(),
})
const mutationSchema = z.object({ expectedRevision: z.number().int().positive() })
const statusSchema = mutationSchema.extend({ taskId: z.string(), status: z.enum(["backlog", "running", "done"]) })
const proposalInputSchema = mutationSchema.extend({ id: z.string(), taskId: z.string(), draft: z.string(), dependencyVersion: z.number().int().positive() })
const presentationSchema = mutationSchema.extend({ taskId: z.string(), caption: z.string() })

const initial = {
  tasks: [
    { id: "TASK-104", title: "고객 인터뷰 요약", status: "running", version: 1 },
    { id: "TASK-108", title: "검색 결과 정렬", status: "backlog", version: 1 },
  ],
  presentation: { "TASK-104": "이번 주 실행 중", "TASK-108": "다음 검토 대상" },
  proposals: [{ id: "proposal-1", taskId: "TASK-104", draft: "인터뷰 근거를 두 문단으로 정리", dependencyVersion: 1 }],
  taskInfoFile: "tasks/TASK-104.md",
}

const json = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(payload))
}

const body = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export const createOwnershipHandler = ({ root, host }) => {
  const repository = new FileCasRepository({ root })
  const read = async () => {
    const existing = await repository.read("mixed-backlog")
    return existing ?? repository.create({ documentId: "mixed-backlog", content: initial, actorId: "demo" })
  }
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (!url.pathname.startsWith("/api/ownership/mixed")) return false
    const session = host.sessionFor(request)
    try {
      host.authority.require(session, "mixed-backlog", request.method === "GET" ? "read" : "write")
      if (request.method === "GET" && url.pathname === "/api/ownership/mixed") {
        const record = await read()
        json(response, 200, { revision: record.revision, ...mixedSchema.parse(record.content) })
        return true
      }
      const current = await read()
      const content = mixedSchema.parse(current.content)
      let next
      if (request.method === "POST" && url.pathname.endsWith("/task-status")) {
        const input = statusSchema.parse(await body(request))
        const task = content.tasks.find((item) => item.id === input.taskId)
        if (task === undefined) { json(response, 404, { error: "task_not_found" }); return true }
        next = { ...content, tasks: content.tasks.map((item) => item.id === input.taskId ? { ...item, status: input.status, version: item.version + 1 } : item) }
        await repository.update("mixed-backlog", input.expectedRevision, next, { actorId: session.subject })
      } else if (request.method === "POST" && url.pathname.endsWith("/proposal")) {
        const input = proposalInputSchema.parse(await body(request))
        const task = content.tasks.find((item) => item.id === input.taskId)
        if (task === undefined) { json(response, 404, { error: "task_not_found" }); return true }
        if (task.version !== input.dependencyVersion) { json(response, 409, { error: "stale_dependency", actualVersion: task.version }); return true }
        const proposal = { id: input.id, taskId: input.taskId, draft: input.draft, dependencyVersion: input.dependencyVersion }
        next = { ...content, proposals: [...content.proposals.filter((item) => item.id !== input.id), proposal] }
        await repository.update("mixed-backlog", input.expectedRevision, next, { actorId: session.subject })
      } else if (request.method === "POST" && url.pathname.endsWith("/presentation")) {
        const input = presentationSchema.parse(await body(request))
        next = { ...content, presentation: { ...content.presentation, [input.taskId]: input.caption } }
        await repository.update("mixed-backlog", input.expectedRevision, next, { actorId: session.subject })
      } else {
        json(response, 405, { error: "method_not_allowed" })
        return true
      }
      const updated = await repository.read("mixed-backlog")
      json(response, 200, { revision: updated?.revision, ...mixedSchema.parse(updated?.content) })
      return true
    } catch (error) {
      if (error instanceof RevisionConflictError) { json(response, 409, { error: "stale_revision", actualRevision: error.actual }); return true }
      if (error instanceof z.ZodError || error instanceof SyntaxError) { json(response, 400, { error: "invalid_request" }); return true }
      if (session === null || (error instanceof Error && error.name === "AccessDeniedError")) { json(response, session === null ? 401 : 403, { error: "forbidden" }); return true }
      throw error
    }
  }
}

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { FileCasRepository, RevisionConflictError } from "@block-editor/server-bindings"
import { z } from "zod"
import { markdownRoot } from "./markdown-core.mjs"

const MAX_BODY = 256 * 1024
const inlineSchema = z.object({ kind: z.literal("text"), text: z.string().max(20_000), marks: z.array(z.unknown()).max(100) }).strict()
const blockSchema = z.object({ id: z.string().min(1).max(200), type: z.string().min(1).max(100), attrs: z.record(z.string(), z.unknown()), content: z.array(inlineSchema).max(200) }).strict()
const documentSchema = z.object({ format: z.literal("block-editor/v0.3"), blocks: z.array(blockSchema).min(1).max(200) }).strict()
const taskSchema = z.object({ id: z.string().min(1), title: z.string().min(1), status: z.enum(["backlog", "running", "done"]), version: z.number().int().positive() }).strict()
const proposalSchema = z.object({ id: z.string().min(1), taskId: z.string().min(1), document: documentSchema, dependencyVersion: z.number().int().positive() }).strict()
const mixedSchema = z.object({
  schemaVersion: z.literal(2),
  tasks: z.array(taskSchema),
  presentations: z.record(z.string(), documentSchema),
  proposals: z.array(proposalSchema),
  taskInfoFiles: z.record(z.string(), z.string()),
}).strict()
const legacyDocumentSchema = z.union([documentSchema, z.string()])
const legacyMixedSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  tasks: z.array(taskSchema),
  presentations: z.record(z.string(), legacyDocumentSchema),
  proposals: z.array(z.object({ id: z.string(), taskId: z.string(), document: legacyDocumentSchema, dependencyVersion: z.number().int().positive() }).strict()),
  taskInfoFiles: z.record(z.string(), z.string()),
}).strict()
const revisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict()
const statusSchema = revisionSchema.extend({ taskId: z.string(), status: z.enum(["backlog", "running", "done"]) }).strict()
const documentInputSchema = revisionSchema.extend({ taskId: z.string(), document: documentSchema }).strict()
const proposalInputSchema = documentInputSchema.extend({ id: z.string(), dependencyVersion: z.number().int().positive() }).strict()

const text = (id, value) => ({ id, type: "ownership.caption", attrs: {}, content: [{ kind: "text", text: value, marks: [] }] })
const initial = {
  schemaVersion: 2,
  tasks: [
    { id: "TASK-104", title: "고객 인터뷰 요약", status: "running", version: 1 },
    { id: "TASK-108", title: "검색 결과 정렬", status: "backlog", version: 1 },
  ],
  presentations: {
    "TASK-104": { format: "block-editor/v0.3", blocks: [text("caption-104", "이번 주 실행 중")] },
    "TASK-108": { format: "block-editor/v0.3", blocks: [text("caption-108", "다음 검토 대상")] },
  },
  proposals: [{ id: "proposal-1", taskId: "TASK-104", document: { format: "block-editor/v0.3", blocks: [text("proposal-text-1", "인터뷰 근거를 두 문단으로 정리")] }, dependencyVersion: 1 }],
  taskInfoFiles: { "TASK-104": "tasks/TASK-104.md", "TASK-108": "tasks/TASK-108.md" },
}
const documentFromLegacy = (id, value) => typeof value === "string"
  ? { format: "block-editor/v0.3", blocks: [text(id, value)] }
  : value
export const migrateMixedContent = (input) => {
  const current = mixedSchema.safeParse(input)
  if (current.success) return { migrated: false, content: current.data }
  const legacy = legacyMixedSchema.parse(input)
  return {
    migrated: true,
    content: {
      schemaVersion: 2,
      tasks: legacy.tasks,
      presentations: Object.fromEntries(Object.entries(legacy.presentations).map(([taskId, value]) => [taskId, documentFromLegacy(`caption-${taskId}`, value)])),
      proposals: legacy.proposals.map((proposal) => ({ ...proposal, document: documentFromLegacy(`proposal-${proposal.id}`, proposal.document) })),
      taskInfoFiles: legacy.taskInfoFiles,
    },
  }
}

const json = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(payload))
}
const body = async (request) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new RangeError("Request too large"); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}
const ensureTaskFiles = async () => {
  const root = markdownRoot()
  await mkdir(join(root, "tasks"), { recursive: true })
  await Promise.all(initial.tasks.map(async (task) => {
    try { await writeFile(join(root, "tasks", `${task.id}.md`), `# ${task.id} ${task.title}\n\n상태: ${task.status}\n`, { flag: "wx" }) } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error }
  }))
}

export const createOwnershipHandler = ({ root, host }) => {
  const repository = new FileCasRepository({ root })
  const read = async () => {
    const existing = await repository.read("mixed-backlog")
    if (existing !== null) {
      const parsed = migrateMixedContent(existing.content)
      if (!parsed.migrated) return existing
      try { return await repository.update("mixed-backlog", existing.revision, parsed.content, { actorId: "migration-v2" }) }
      catch (error) { if (!(error instanceof RevisionConflictError)) throw error; const winner = await repository.read("mixed-backlog"); if (winner === null) throw error; return winner }
    }
    try { await ensureTaskFiles(); return await repository.create({ documentId: "mixed-backlog", content: initial, actorId: "demo" }) }
    catch (error) { if (!(error instanceof RevisionConflictError)) throw error; const winner = await repository.read("mixed-backlog"); if (winner === null) throw error; return winner }
  }
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (!url.pathname.startsWith("/api/ownership/mixed")) return false
    const known = new Set(["/api/ownership/mixed", "/api/ownership/mixed/task-status", "/api/ownership/mixed/presentation", "/api/ownership/mixed/proposal"])
    if (!known.has(url.pathname)) { json(response, 404, { error: "not_found" }); return true }
    const session = host.sessionFor(request)
    try {
      host.authority.require(session, "mixed-backlog", request.method === "GET" ? "read" : "write")
      if (request.method === "GET") { if (url.pathname !== "/api/ownership/mixed") { json(response, 405, { error: "method_not_allowed" }); return true }; const record = await read(); json(response, 200, { revision: record.revision, ...mixedSchema.parse(record.content) }); return true }
      if (request.method !== "POST") { json(response, 405, { error: "method_not_allowed" }); return true }
      const current = await read()
      const content = mixedSchema.parse(current.content)
      const raw = await body(request)
      let next
      if (url.pathname.endsWith("/task-status")) {
        const input = statusSchema.parse(raw); const task = content.tasks.find((item) => item.id === input.taskId)
        if (task === undefined) { json(response, 404, { error: "task_not_found" }); return true }
        next = { ...content, tasks: content.tasks.map((item) => item.id === input.taskId ? { ...item, status: input.status, version: item.version + 1 } : item) }
      } else if (url.pathname.endsWith("/presentation")) {
        const input = documentInputSchema.parse(raw); if (!content.tasks.some((task) => task.id === input.taskId)) { json(response, 404, { error: "task_not_found" }); return true }
        next = { ...content, presentations: { ...content.presentations, [input.taskId]: input.document } }
      } else {
        const input = proposalInputSchema.parse(raw); const task = content.tasks.find((item) => item.id === input.taskId)
        if (task === undefined) { json(response, 404, { error: "task_not_found" }); return true }
        if (task.version !== input.dependencyVersion) { json(response, 409, { error: "stale_dependency", actualVersion: task.version }); return true }
        const proposal = { id: input.id, taskId: input.taskId, document: input.document, dependencyVersion: input.dependencyVersion }
        next = { ...content, proposals: [...content.proposals.filter((item) => item.id !== input.id), proposal] }
      }
      const expected = Number(raw.expectedRevision)
      const saved = await repository.update("mixed-backlog", expected, next, { actorId: session.subject })
      json(response, 200, { revision: saved.revision, ...mixedSchema.parse(saved.content) })
      return true
    } catch (error) {
      if (error instanceof RevisionConflictError) { json(response, 409, { error: "stale_revision", actualRevision: error.actual }); return true }
      if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError) { json(response, error instanceof RangeError ? 413 : 400, { error: "invalid_request" }); return true }
      if (session === null || (error instanceof Error && error.name === "AccessDeniedError")) { json(response, session === null ? 401 : 403, { error: "forbidden" }); return true }
      throw error
    }
  }
}

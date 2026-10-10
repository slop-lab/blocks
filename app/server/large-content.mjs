import { FileCasRepository, RevisionConflictError } from "@block-editor/server-bindings"

const DEFAULT_COUNT = 1_600
const MAX_PAGE = 100
const MAX_BODY_BYTES = 256_000

const syntheticText = (index) =>
  `문서 보관함의 ${index + 1}번째 문단입니다. 긴 문서에서 필요한 내용을 찾고 안전하게 수정할 수 있습니다.`

export const createLargeContentRepository = (count = DEFAULT_COUNT) => {
  const revisions = new Map()
  const edits = new Map()
  const makeBlock = (index) => ({
    id: `paragraph-${String(index).padStart(4, "0")}`,
    index,
    revision: revisions.get(index) ?? 1,
    text: edits.get(index) ?? syntheticText(index),
  })
  const indexFor = (id) => {
    const match = /^paragraph-(\d{4,})$/.exec(id)
    if (match === null) return null
    const index = Number(match[1])
    return Number.isSafeInteger(index) && index >= 0 && index < count ? index : null
  }
  return {
    page(offset, limit) {
      const start = Math.max(0, Math.min(count, Math.trunc(offset)))
      const size = Math.max(1, Math.min(MAX_PAGE, Math.trunc(limit)))
      const end = Math.min(count, start + size)
      return {
        blocks: Array.from({ length: end - start }, (_, position) => makeBlock(start + position)),
        offset: start,
        total: count,
        continuation: end < count ? end : null,
      }
    },
    block(id) {
      const index = indexFor(id)
      return index === null ? null : makeBlock(index)
    },
    search(query, limit = 20) {
      const needle = query.trim().toLocaleLowerCase()
      if (needle.length === 0) return []
      const matches = []
      for (let index = 0; index < count && matches.length < limit; index += 1) {
        const candidate = makeBlock(index)
        if (candidate.id.includes(needle) || candidate.text.toLocaleLowerCase().includes(needle))
          matches.push(candidate)
      }
      return matches
    },
    patch(id, expectedRevision, text) {
      const index = indexFor(id)
      if (index === null) return { kind: "missing" }
      const current = makeBlock(index)
      if (current.revision !== expectedRevision)
        return { kind: "conflict", current, draft: text }
      revisions.set(index, current.revision + 1)
      edits.set(index, text)
      return { kind: "updated", block: makeBlock(index) }
    },
    exportDocument() {
      return {
        format: "large-content/v1",
        blocks: Array.from({ length: count }, (_, index) => makeBlock(index)),
      }
    },
  }
}

export const createDurableLargeContentRepository = ({ root, count = DEFAULT_COUNT }) => {
  const records = new FileCasRepository({ root })
  const indexFor = (id) => {
    const match = /^paragraph-(\d{4,})$/.exec(id)
    if (match === null) return null
    const index = Number(match[1])
    return Number.isSafeInteger(index) && index >= 0 && index < count ? index : null
  }
  const block = async (id) => {
    const index = indexFor(id)
    if (index === null) return null
    const stored = await records.read(id)
    return stored === null
      ? { id, index, revision: 1, text: syntheticText(index) }
      : { id, index, revision: stored.content.revision, text: stored.content.text }
  }
  return {
    async page(offset, limit) {
      const start = Math.max(0, Math.min(count, Math.trunc(offset)))
      const size = Math.max(1, Math.min(MAX_PAGE, Math.trunc(limit)))
      const end = Math.min(count, start + size)
      const ids = Array.from({ length: end - start }, (_, position) =>
        `paragraph-${String(start + position).padStart(4, "0")}`)
      return { blocks: await Promise.all(ids.map(block)), offset: start, total: count, continuation: end < count ? end : null }
    },
    block,
    async search(query, limit = 20) {
      const needle = query.trim().toLocaleLowerCase()
      if (needle.length === 0) return []
      const matches = []
      for (let index = 0; index < count && matches.length < limit; index += 1) {
        const candidate = await block(`paragraph-${String(index).padStart(4, "0")}`)
        if (candidate !== null && (candidate.id.includes(needle) || candidate.text.toLocaleLowerCase().includes(needle))) matches.push(candidate)
      }
      return matches
    },
    async patch(id, expectedRevision, text) {
      const current = await block(id)
      if (current === null) return { kind: "missing" }
      if (current.revision !== expectedRevision) return { kind: "conflict", current, draft: text }
      try {
        const stored = await records.read(id)
        const content = { revision: current.revision + 1, text }
        if (stored === null)
          await records.create({ documentId: id, content, actorId: "large-content" })
        else await records.update(id, stored.revision, content, { actorId: "large-content" })
        return { kind: "updated", block: { ...current, ...content } }
      } catch (error) {
        if (!(error instanceof RevisionConflictError)) throw error
        return { kind: "conflict", current: await block(id), draft: text }
      }
    },
    async exportDocument() {
      const ids = Array.from({ length: count }, (_, index) =>
        `paragraph-${String(index).padStart(4, "0")}`)
      return { format: "large-content/v1", blocks: await Promise.all(ids.map(block)) }
    },
  }
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
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new RangeError("Request body is too large")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export const createLargeContentHandler = ({ root }) => {
  const repository = createDurableLargeContentRepository({ root })
  return async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost")
  if (!url.pathname.startsWith("/api/large-content")) return false
  if (
    request.method === "GET" &&
    (url.pathname === "/api/large-content" || url.pathname === "/api/large-content/")
  ) {
    send(response, 200, await repository.page(Number(url.searchParams.get("offset") ?? 0), Number(url.searchParams.get("limit") ?? 40)))
    return true
  }
  if (request.method === "GET" && url.pathname === "/api/large-content/search") {
    send(response, 200, { results: await repository.search(url.searchParams.get("q") ?? "") })
    return true
  }
  if (request.method === "GET" && url.pathname === "/api/large-content/export") {
    send(response, 200, await repository.exportDocument(), {
      "content-disposition": 'attachment; filename="large-content.json"',
    })
    return true
  }
  const match = /^\/api\/large-content\/block\/([^/]+)$/.exec(url.pathname)
  if (match === null) {
    send(response, 404, { error: "Large-content endpoint not found" })
    return true
  }
  const id = decodeURIComponent(match[1] ?? "")
  if (request.method === "GET") {
    const block = await repository.block(id)
    send(response, block === null ? 404 : 200, block ?? { error: "Block not found" })
    return true
  }
  if (request.method !== "PATCH") {
    send(response, 405, { error: "Method not allowed" }, { allow: "GET, PATCH" })
    return true
  }
  try {
    const body = await readJson(request)
    if (
      typeof body !== "object" ||
      body === null ||
      typeof body.expectedRevision !== "number" ||
      typeof body.text !== "string"
    ) {
      send(response, 400, { error: "expectedRevision and text are required" })
      return true
    }
    const result = await repository.patch(id, body.expectedRevision, body.text)
    send(response, result.kind === "updated" ? 200 : result.kind === "conflict" ? 409 : 404, result)
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError) {
      send(response, 400, { error: error.message })
      return true
    }
    throw error
  }
  return true
  }
}

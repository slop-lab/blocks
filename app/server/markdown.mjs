import {
  listMarkdownFiles,
  listMarkdownTree,
  loadMarkdownFile,
  MAX_MARKDOWN_BYTES,
  MarkdownRequestError,
  markdownRoot,
  previewMarkdown,
  saveMarkdownFile,
} from "./markdown-core.mjs"

const writeJson = (response, status, payload) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  response.end(JSON.stringify(payload))
}

const readJson = async (request) => {
  const declaredLength = Number(request.headers["content-length"] ?? 0)
  if (declaredLength > MAX_MARKDOWN_BYTES + 65_536) {
    throw new MarkdownRequestError(413, "request_too_large", "Request body exceeds the size limit")
  }
  const chunks = []
  let received = 0
  for await (const chunk of request) {
    received += chunk.length
    if (received > MAX_MARKDOWN_BYTES + 65_536) {
      throw new MarkdownRequestError(
        413,
        "request_too_large",
        "Request body exceeds the size limit",
      )
    }
    chunks.push(chunk)
  }
  let value
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new MarkdownRequestError(400, "invalid_json", "Request body must be valid JSON")
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MarkdownRequestError(400, "invalid_body", "Request body must be an object")
  }
  return value
}

const previewInput = (value) => {
  const { name, content } = value
  if (typeof name !== "string" || typeof content !== "string") {
    throw new MarkdownRequestError(400, "invalid_body", "name and content are required")
  }
  return { name, content }
}

const saveInput = (value) => {
  const { expectedRevision } = value
  if (typeof expectedRevision !== "string") {
    throw new MarkdownRequestError(400, "invalid_body", "expectedRevision is required")
  }
  return { ...previewInput(value), expectedRevision }
}

export const handleMarkdown = async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost")
  if (!requestUrl.pathname.startsWith("/api/markdown")) return false
  try {
    const root = markdownRoot()
    if (requestUrl.pathname === "/api/markdown" && request.method === "GET") {
      const [files, tree] = await Promise.all([listMarkdownFiles(root), listMarkdownTree(root)])
      writeJson(response, 200, { files, tree })
      return true
    }
    if (requestUrl.pathname === "/api/markdown/file" && request.method === "GET") {
      writeJson(response, 200, await loadMarkdownFile(root, requestUrl.searchParams.get("name")))
      return true
    }
    if (requestUrl.pathname === "/api/markdown/file" && request.method === "PUT") {
      writeJson(response, 200, await saveMarkdownFile(root, saveInput(await readJson(request))))
      return true
    }
    if (requestUrl.pathname === "/api/markdown/map" && request.method === "POST") {
      writeJson(response, 200, await previewMarkdown(root, previewInput(await readJson(request))))
      return true
    }
    writeJson(response, 405, {
      error: "method_not_allowed",
      message: "Unsupported Markdown API operation",
    })
    return true
  } catch (error) {
    if (error instanceof MarkdownRequestError) {
      writeJson(response, error.status, {
        error: error.code,
        message: error.message,
        ...error.details,
      })
      return true
    }
    throw error
  }
}

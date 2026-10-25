import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import MarkdownIt from "markdown-it"

export const MAX_MARKDOWN_BYTES = 2_000_000
const SAMPLE_NAME = "README.md"
const SAMPLE_CONTENT =
  "# Markdown Workspace\n\nSelect a file on the left to edit its Markdown source.\n"
const parser = new MarkdownIt({ html: true, linkify: true, typographer: false })
const mappingCache = new Map()
const mappingEpoch = randomUUID()
// Serializes this server process; external editors are detected by the hash reread but not locked.
const processWriteQueues = new Map()

export class MarkdownRequestError extends Error {
  constructor(status, code, message, details = {}) {
    super(message)
    this.name = "MarkdownRequestError"
    this.status = status
    this.code = code
    this.details = details
  }
}

export const markdownRoot = () => resolve(process.env.MARKDOWN_ROOT ?? ".runtime/markdown")

export const revisionOf = (content) => createHash("sha256").update(content, "utf8").digest("hex")

const filePath = (root, name) => {
  if (
    typeof name !== "string" ||
    isAbsolute(name) ||
    name.includes("\\") ||
    !name.toLowerCase().endsWith(".md") ||
    name.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new MarkdownRequestError(400, "invalid_name", "Markdown file name is invalid")
  }
  const candidate = resolve(root, name)
  const fromRoot = relative(root, candidate)
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new MarkdownRequestError(400, "invalid_name", "Markdown file must stay inside the root")
  }
  return candidate
}

const markdownInventory = async (root) => {
  const walk = async (directory, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true })
    const tree = []
    const files = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        const nested = await walk(join(directory, entry.name), path)
        if (nested.files.length > 0) {
          tree.push({ kind: "directory", name: entry.name, path, children: nested.tree })
          files.push(...nested.files)
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        tree.push({ kind: "file", name: entry.name, path })
        files.push(path)
      }
    }
    return { files, tree }
  }
  return walk(root)
}

export const listMarkdownFiles = async (root) => {
  await mkdir(root, { recursive: true })
  const sample = join(root, SAMPLE_NAME)
  try {
    await writeFile(sample, SAMPLE_CONTENT, { encoding: "utf8", flag: "wx" })
  } catch (error) {
    if (!(error instanceof Error) || !Object.hasOwn(error, "code") || error.code !== "EEXIST")
      throw error
  }
  return (await markdownInventory(root)).files
}

export const listMarkdownTree = async (root) => {
  await listMarkdownFiles(root)
  return (await markdownInventory(root)).tree
}

const requireAllowlistedPath = async (root, name) => {
  const path = filePath(root, name)
  const files = await listMarkdownFiles(root)
  if (!files.includes(name)) {
    throw new MarkdownRequestError(404, "file_not_found", "Markdown file is not allowlisted")
  }
  return path
}

const mappingType = (tokenType) => {
  if (tokenType === "heading_open") return "heading"
  if (tokenType === "paragraph_open") return "paragraph"
  if (tokenType === "fence" || tokenType === "code_block") return "code"
  return "raw"
}

const mappedTokens = (content) => {
  const lines = content.split("\n")
  return parser
    .parse(content, {})
    .filter(
      (token) =>
        token.level === 0 &&
        token.map !== null &&
        (token.nesting !== -1 || token.type === "fence" || token.type === "code_block"),
    )
    .map((token) => {
      const [start, end] = token.map
      return {
        type: mappingType(token.type),
        startLine: start + 1,
        endLine: Math.max(start + 1, end),
        raw: lines.slice(start, end).join("\n"),
      }
    })
}

export const mapMarkdown = (cacheKey, content) => {
  const previous = mappingCache.get(cacheKey) ?? []
  const available = new Map()
  for (const mapping of previous) {
    const signature = `${mapping.type}\u0000${mapping.raw}`
    const ids = available.get(signature) ?? []
    ids.push(mapping.id)
    available.set(signature, ids)
  }
  const cached = mappedTokens(content).map((mapping) => {
    const signature = `${mapping.type}\u0000${mapping.raw}`
    const ids = available.get(signature)
    return { ...mapping, id: ids?.shift() ?? randomUUID() }
  })
  mappingCache.set(cacheKey, cached)
  return cached.map(({ raw: _raw, ...mapping }) => mapping)
}

const boundedRead = async (path) => {
  const metadata = await stat(path)
  if (!metadata.isFile())
    throw new MarkdownRequestError(404, "file_not_found", "Markdown file is missing")
  if (metadata.size > MAX_MARKDOWN_BYTES) {
    throw new MarkdownRequestError(413, "file_too_large", "Markdown file exceeds the size limit")
  }
  return readFile(path, "utf8")
}

export const loadMarkdownFile = async (root, name) => {
  const path = await requireAllowlistedPath(root, name)
  const content = await boundedRead(path)
  return {
    name,
    content,
    revision: revisionOf(content),
    mappings: mapMarkdown(`${mappingEpoch}:${root}:${name}`, content),
  }
}

export const previewMarkdown = async (root, input) => {
  await requireAllowlistedPath(root, input.name)
  if (Buffer.byteLength(input.content, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new MarkdownRequestError(413, "file_too_large", "Markdown draft exceeds the size limit")
  }
  return { mappings: mapMarkdown(`${mappingEpoch}:${root}:${input.name}`, input.content) }
}

export const saveMarkdownFile = async (root, input) => {
  const path = await requireAllowlistedPath(root, input.name)
  if (Buffer.byteLength(input.content, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new MarkdownRequestError(413, "file_too_large", "Markdown draft exceeds the size limit")
  }
  const previous = processWriteQueues.get(path) ?? Promise.resolve()
  let release
  const gate = new Promise((resolveGate) => {
    release = resolveGate
  })
  const tail = previous.then(() => gate)
  processWriteQueues.set(path, tail)
  await previous
  try {
    const diskContent = await boundedRead(path)
    const diskRevision = revisionOf(diskContent)
    if (diskRevision !== input.expectedRevision) {
      throw new MarkdownRequestError(409, "stale_revision", "The file changed on disk", {
        name: input.name,
        content: diskContent,
        revision: diskRevision,
        mappings: mapMarkdown(`${mappingEpoch}:${root}:${input.name}`, diskContent),
      })
    }
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
    let renamed = false
    try {
      await writeFile(temporary, input.content, { encoding: "utf8", flag: "wx" })
      await rename(temporary, path)
      renamed = true
    } finally {
      if (!renamed) await rm(temporary, { force: true })
    }
    return {
      name: input.name,
      content: input.content,
      revision: revisionOf(input.content),
      mappings: mapMarkdown(`${mappingEpoch}:${root}:${input.name}`, input.content),
    }
  } finally {
    release()
    if (processWriteQueues.get(path) === tail) processWriteQueues.delete(path)
  }
}

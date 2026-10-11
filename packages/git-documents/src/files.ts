import { createHash, randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { GitDocumentsError } from "./errors.js"
import type { DocumentTreeNode, Draft } from "./types.js"

export const contentRevision = (content: string): string =>
  createHash("sha256").update(content).digest("hex")

export const readText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

export const atomicWrite = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export const assertNoSymlink = async (root: string, relative: string): Promise<void> => {
  const parts = relative.split("/")
  let current = root
  for (const part of parts) {
    current = join(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new GitDocumentsError("invalid_path", "Symbolic links are not document paths")
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return
      throw error
    }
  }
}

export const draftName = (path: string): string =>
  `${createHash("sha256").update(path).digest("hex")}.json`

export const readDraft = async (path: string): Promise<Draft | null> => {
  const content = await readText(path)
  if (content === null) return null
  const value: unknown = JSON.parse(content)
  if (
    typeof value !== "object" ||
    value === null ||
    !("content" in value) ||
    !("baseRevision" in value) ||
    !("updatedAt" in value) ||
    typeof value.content !== "string" ||
    typeof value.baseRevision !== "string" ||
    typeof value.updatedAt !== "string"
  )
    throw new GitDocumentsError("invalid_path", "Stored draft is invalid")
  return { content: value.content, baseRevision: value.baseRevision, updatedAt: value.updatedAt }
}

export const listTree = async (root: string, prefix = ""): Promise<readonly DocumentTreeNode[]> => {
  let entries: Dirent[]
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
  const nodes: DocumentTreeNode[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      const children = await listTree(root, path)
      if (children.length > 0) nodes.push({ kind: "directory", name: entry.name, path, children })
    } else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".md")) {
      nodes.push({ kind: "file", name: basename(entry.name), path })
    }
  }
  return nodes
}

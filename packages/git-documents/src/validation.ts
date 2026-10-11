import { isAbsolute, posix } from "node:path"
import { GitDocumentsError } from "./errors.js"

const pathPattern = /^[\p{L}\p{N}][\p{L}\p{N} ._()/-]{0,239}$/u
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/

export const documentPath = (value: string, extension = ".md"): string => {
  if (
    !pathPattern.test(value) ||
    isAbsolute(value) ||
    value.startsWith("-") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.split("/").some((part) => part === "." || part === ".." || part === ".git") ||
    !value.toLocaleLowerCase().endsWith(extension)
  )
    throw new GitDocumentsError("invalid_path", "Document path is outside the configured root")
  return posix.normalize(value)
}

export const relativeRoot = (value: string): string => {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")
  if (
    normalized.length === 0 ||
    isAbsolute(normalized) ||
    normalized.startsWith("-") ||
    normalized.split("/").some((part) => part === "." || part === ".." || part === ".git")
  )
    throw new GitDocumentsError("invalid_path", "Documents root must be repository-relative")
  return normalized
}

export const branchName = (value: string): string => {
  if (
    !branchPattern.test(value) ||
    value.startsWith("-") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock")
  )
    throw new GitDocumentsError("invalid_branch", "Branch name is not safe for a managed worktree")
  return value
}

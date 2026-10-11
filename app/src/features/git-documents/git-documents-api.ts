import ky from "ky"
import { z } from "zod"

const treeSchema: z.ZodType<GitDocumentTreeNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("file"), name: z.string(), path: z.string() }),
    z.object({
      kind: z.literal("directory"),
      name: z.string(),
      path: z.string(),
      children: z.array(treeSchema),
    }),
  ]),
)
const draftSchema = z.object({
  content: z.string(),
  baseRevision: z.string(),
  updatedAt: z.string(),
})
const fileSchema = z.object({
  path: z.string(),
  content: z.string(),
  revision: z.string(),
  draft: draftSchema.nullable(),
})
const changeSchema = z.object({
  path: z.string(),
  staged: z.enum(["added", "modified", "deleted", "renamed", "unmodified"]),
  working: z.enum(["added", "modified", "deleted", "renamed", "unmodified"]),
  conflict: z.boolean(),
})
const remoteSchema = z.object({
  remote: z.literal("origin"),
  branch: z.string(),
  ahead: z.number(),
  behind: z.number(),
  state: z.enum(["current", "ahead", "behind", "diverged", "untracked"]),
})
const stateSchema = z.object({
  repository: z.string(),
  branch: z.string(),
  docs: z.string(),
  tree: z.array(treeSchema),
  changes: z.array(changeSchema),
  remote: remoteSchema,
})
const historySchema = z.object({
  entries: z.array(
    z.object({
      commit: z.string(),
      author: z.string(),
      authoredAt: z.string(),
      subject: z.string(),
    }),
  ),
})
const diffSchema = z.object({
  path: z.string(),
  head: z.string().nullable(),
  working: z.string().nullable(),
  staged: z.string().nullable(),
})
const branchesSchema = z.object({
  branches: z.array(z.object({ name: z.string(), current: z.boolean(), managed: z.boolean() })),
})
const searchSchema = z.object({
  results: z.array(z.object({ path: z.string(), line: z.number(), excerpt: z.string() })),
})

export type GitDocumentTreeNode =
  | { readonly kind: "file"; readonly name: string; readonly path: string }
  | {
      readonly kind: "directory"
      readonly name: string
      readonly path: string
      readonly children: readonly GitDocumentTreeNode[]
    }
export type GitDocumentFile = z.infer<typeof fileSchema>
export type GitDocumentsState = z.infer<typeof stateSchema>
export type GitHistoryEntry = z.infer<typeof historySchema>["entries"][number]
export type GitDocumentDiff = z.infer<typeof diffSchema>
export type GitBranch = z.infer<typeof branchesSchema>["branches"][number]
export type GitSearchResult = z.infer<typeof searchSchema>["results"][number]

const client = ky.create({ prefix: "api/git-documents", timeout: 15_000, retry: 0 })
const mutation = async (path: string, json: unknown, method: "post" | "put" | "delete" = "post") =>
  client(path, { method, json }).json<unknown>()

export const gitDocumentsApi = {
  state: async () => stateSchema.parse(await client.get("").json()),
  file: async (path: string) =>
    fileSchema.parse(await client.get("file", { searchParams: { path } }).json()),
  write: async (file: GitDocumentFile, content: string) =>
    fileSchema.parse(
      await mutation("file", { path: file.path, content, expectedRevision: file.revision }, "put"),
    ),
  draft: async (file: GitDocumentFile, content: string) =>
    mutation("draft", { path: file.path, content, baseRevision: file.revision }, "put"),
  clearDraft: async (path: string) => mutation("draft", { path }, "delete"),
  create: async (path: string) =>
    fileSchema.parse(
      await mutation("documents", { path, content: `# ${path.replace(/\.md$/u, "")}\n\n` }),
    ),
  rename: async (file: GitDocumentFile, to: string) =>
    fileSchema.parse(
      await mutation("rename", { from: file.path, to, expectedRevision: file.revision }),
    ),
  remove: async (file: GitDocumentFile) =>
    mutation("delete", { path: file.path, expectedRevision: file.revision }),
  diff: async (path: string) =>
    diffSchema.parse(await client.get("diff", { searchParams: { path } }).json()),
  history: async (path: string) =>
    historySchema.parse(await client.get("history", { searchParams: { path } }).json()).entries,
  restore: async (path: string, commit: string) =>
    fileSchema.parse(await mutation("restore", { path, commit })),
  commit: async (
    paths: readonly string[],
    message: string,
    expectedRevisions: Readonly<Record<string, string | null>>,
  ) => mutation("commit", { paths, message, expectedRevisions }),
  branches: async () => branchesSchema.parse(await client.get("branches").json()).branches,
  createBranch: async (branch: string) => mutation("branches", { branch }),
  switchBranch: async (branch: string) => mutation("branch/switch", { branch }),
  search: async (query: string) =>
    searchSchema.parse(await client.get("search", { searchParams: { q: query } }).json()).results,
  backlinks: async (path: string) =>
    searchSchema.parse(await client.get("backlinks", { searchParams: { path } }).json()).results,
  remote: async (action: "fetch" | "fast-forward" | "push" | "merge" | "abort") =>
    mutation(`remote/${action}`, {}),
  resolve: async (file: GitDocumentFile, content: string) =>
    fileSchema.parse(
      await mutation("remote/resolve", {
        path: file.path,
        content,
        expectedRevision: file.revision,
      }),
    ),
  completeMerge: async (message: string) =>
    remoteSchema.parse(await mutation("remote/complete", { message })),
} as const

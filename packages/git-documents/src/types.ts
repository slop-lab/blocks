export type GitDocumentsOptions = {
  readonly repo: string
  readonly docs?: string
  readonly data?: string
  readonly branch?: string
  readonly remote?: "origin"
  readonly author?: {
    readonly name: string
    readonly email: string
  }
}

export type Draft = {
  readonly content: string
  readonly baseRevision: string
  readonly updatedAt: string
}

export type DocumentFile = {
  readonly path: string
  readonly content: string
  readonly revision: string
  readonly draft: Draft | null
}

export type DocumentTreeNode =
  | { readonly kind: "file"; readonly name: string; readonly path: string }
  | {
      readonly kind: "directory"
      readonly name: string
      readonly path: string
      readonly children: readonly DocumentTreeNode[]
    }

export type ChangeState = "added" | "modified" | "deleted" | "renamed" | "unmodified"
export type DocumentStatus = {
  readonly path: string
  readonly staged: ChangeState
  readonly working: ChangeState
  readonly conflict: boolean
}

export type CommitResult = { readonly commit: string; readonly message: string }
export type HistoryEntry = {
  readonly commit: string
  readonly author: string
  readonly authoredAt: string
  readonly subject: string
}

export type RemoteStatus = {
  readonly remote: "origin"
  readonly branch: string
  readonly ahead: number
  readonly behind: number
  readonly state: "current" | "ahead" | "behind" | "diverged" | "untracked"
}

export type DocumentDiff = {
  readonly path: string
  readonly head: string | null
  readonly working: string | null
  readonly staged: string | null
}

export type SearchResult = {
  readonly path: string
  readonly line: number
  readonly excerpt: string
}

export type BranchInfo = {
  readonly name: string
  readonly current: boolean
  readonly managed: boolean
}

export type MergeResult = {
  readonly state: "ready" | "conflicts"
  readonly conflicts: readonly string[]
}

export type GitDocumentsErrorCode =
  | "invalid_repository"
  | "invalid_path"
  | "invalid_branch"
  | "not_found"
  | "already_exists"
  | "stale_revision"
  | "dirty_worktree"
  | "staged_changes"
  | "git_failed"
  | "missing_identity"
  | "remote_unavailable"
  | "diverged"

export class GitDocumentsError extends Error {
  readonly name = "GitDocumentsError"
  constructor(
    readonly code: GitDocumentsErrorCode,
    message: string,
    readonly details: Readonly<Record<string, string | number>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

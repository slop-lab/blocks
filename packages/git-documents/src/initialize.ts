import { mkdir, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { GitDocumentsError } from "./errors.js"
import { atomicWrite } from "./files.js"
import { runGit } from "./git.js"
import { relativeRoot } from "./validation.js"

type InitializeOptions = {
  readonly repo: string
  readonly docs?: string
  readonly author?: { readonly name: string; readonly email: string }
}

const welcome = `# Document workshop

Write in the visual editor or switch to Markdown source whenever exact syntax matters.

## A first collection

- Keep related notes in folders.
- Review changes before creating a commit.
- Fetch and push only when you choose.

> Drafts recover independently from Git history.

\`\`\`text
The editor preserves unsupported Markdown source exactly.
\`\`\`
`

export const initializeGitDocumentsRepository = async (
  options: InitializeOptions,
): Promise<{ readonly repo: string; readonly document: string }> => {
  const repo = resolve(options.repo)
  await mkdir(repo, { recursive: true })
  if ((await readdir(repo)).length > 0)
    throw new GitDocumentsError("invalid_repository", "Initialization requires an empty directory")
  const docs = relativeRoot(options.docs ?? "docs")
  await runGit({ cwd: repo, args: ["init", "-b", "main"] })
  await atomicWrite(join(repo, ".gitignore"), ".runtime/\n")
  const document = join(repo, docs, "welcome.md")
  await atomicWrite(document, welcome)
  await runGit({ cwd: repo, args: ["add", "--", ".gitignore", `${docs}/welcome.md`] })
  try {
    await runGit({
      cwd: repo,
      args: ["commit", "-m", "Initialize document workshop"],
      ...(options.author === undefined ? {} : { author: options.author }),
    })
  } catch (error) {
    if (error instanceof GitDocumentsError && /identity|email|name/u.test(error.message))
      throw new GitDocumentsError(
        "missing_identity",
        "Pass --author-name and --author-email or configure identity for the new repository",
      )
    throw error
  }
  return { repo, document }
}

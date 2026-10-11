#!/usr/bin/env node
import { once } from "node:events"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { GitDocuments, initializeGitDocumentsRepository } from "@block-editor/git-documents"
import { createGitDocumentsServer } from "@block-editor/git-documents-host"
import { parseInit, parseStart } from "./options.js"

const help = `block-docs - personal Markdown and Git document workspace

Usage:
  block-docs start --repo <path> [--docs docs] [--data path] [--branch block-docs]
                   [--host 127.0.0.1] [--port 3000]
  block-docs init --repo <path> [--docs docs]
                  [--author-name name --author-email email]
  block-docs --help

The start command creates or reuses an app-managed worktree under .runtime/git-documents.
It never checks out, resets, stashes, or deletes the repository's primary worktree.
`

const start = async (args: readonly string[]): Promise<void> => {
  const options = parseStart(args)
  const documents = await GitDocuments.open(options)
  const workspaceAssets = resolve(process.cwd(), "dist")
  const packagedAssets = fileURLToPath(new URL("../../../dist/", import.meta.url))
  const assetsRoot = existsSync(workspaceAssets) ? workspaceAssets : packagedAssets
  const server = createGitDocumentsServer({ documents, assetsRoot })
  server.listen(options.port, options.host)
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string")
    throw new TypeError("Server address is unavailable")
  const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host
  process.stdout.write(
    `Document workshop: http://${displayHost}:${address.port}/?workspace=git-documents\n`,
  )
  const close = () => server.close(() => process.exit(0))
  process.once("SIGINT", close)
  process.once("SIGTERM", close)
}

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2)
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(help)
    return
  }
  if (command === "start") {
    await start(args)
    return
  }
  if (command === "init") {
    const result = await initializeGitDocumentsRepository(parseInit(args))
    process.stdout.write(`Initialized ${result.repo}\nCreated ${result.document}\n`)
    return
  }
  throw new TypeError(`Unknown command: ${command}`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Command failed"}\n`)
  process.exitCode = 1
}

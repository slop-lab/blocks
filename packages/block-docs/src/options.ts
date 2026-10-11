import { resolve } from "node:path"
import { parseArgs } from "node:util"

export type StartOptions = {
  readonly repo: string
  readonly docs: string
  readonly data?: string
  readonly branch: string
  readonly host: "127.0.0.1" | "localhost" | "0.0.0.0"
  readonly port: number
  readonly author?: { readonly name: string; readonly email: string }
}

export type InitOptions = {
  readonly repo: string
  readonly docs: string
  readonly author?: { readonly name: string; readonly email: string }
}

const author = (name: string | undefined, email: string | undefined) => {
  if ((name === undefined) !== (email === undefined))
    throw new TypeError("--author-name and --author-email must be provided together")
  return name === undefined || email === undefined ? undefined : { name, email }
}

const isHost = (value: string): value is StartOptions["host"] =>
  value === "127.0.0.1" || value === "localhost" || value === "0.0.0.0"

export const parseStart = (args: readonly string[]): StartOptions => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      repo: { type: "string" },
      docs: { type: "string", default: "docs" },
      data: { type: "string" },
      branch: { type: "string", default: "block-docs" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "3000" },
      "author-name": { type: "string" },
      "author-email": { type: "string" },
    },
  })
  if (values.repo === undefined) throw new TypeError("start requires --repo <path>")
  if (!isHost(values.host))
    throw new TypeError("--host must be 127.0.0.1, localhost, or explicit 0.0.0.0")
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new TypeError("--port must be an integer from 0 to 65535")
  const identity = author(values["author-name"], values["author-email"])
  return {
    repo: resolve(values.repo),
    docs: values.docs,
    branch: values.branch,
    host: values.host,
    port,
    ...(values.data === undefined ? {} : { data: resolve(values.data) }),
    ...(identity === undefined ? {} : { author: identity }),
  }
}

export const parseInit = (args: readonly string[]): InitOptions => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      repo: { type: "string" },
      docs: { type: "string", default: "docs" },
      "author-name": { type: "string" },
      "author-email": { type: "string" },
    },
  })
  if (values.repo === undefined) throw new TypeError("init requires --repo <path>")
  const identity = author(values["author-name"], values["author-email"])
  return {
    repo: resolve(values.repo),
    docs: values.docs,
    ...(identity === undefined ? {} : { author: identity }),
  }
}

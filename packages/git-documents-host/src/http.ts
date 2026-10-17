import type { IncomingMessage, ServerResponse } from "node:http"
import { GitDocumentsError } from "@slop-lab/blocks-git-documents"
import { z } from "zod"

export const json = (response: ServerResponse, status: number, value: unknown): void => {
  response
    .writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    })
    .end(JSON.stringify(value))
}

export const body = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > 6 * 1024 * 1024) throw new HttpBoundaryError(413, "Request body is too large")
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export const sameOrigin = (request: IncomingMessage): boolean => {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}

export class HttpBoundaryError extends Error {
  readonly name = "HttpBoundaryError"
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const sendError = (response: ServerResponse, error: unknown): void => {
  if (error instanceof HttpBoundaryError) {
    json(response, error.status, { error: "invalid_request", message: error.message })
    return
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    json(response, 400, { error: "invalid_request", message: "Request payload is invalid" })
    return
  }
  if (error instanceof GitDocumentsError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "stale_revision" ||
            error.code === "diverged" ||
            error.code === "dirty_worktree" ||
            error.code === "staged_changes" ||
            error.code === "already_exists"
          ? 409
          : 400
    json(response, status, { error: error.code, message: error.message, details: error.details })
    return
  }
  json(response, 500, {
    error: "operation_failed",
    message: "The operation could not be completed",
  })
}

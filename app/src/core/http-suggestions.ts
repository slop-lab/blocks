import ky from "ky"
import { parseDocumentText } from "./codec"
import type { SuggestionProvider } from "./proposals"

export type HttpSuggestionOptions = {
  readonly endpoint: string
  readonly headers?: Readonly<Record<string, string>>
  readonly timeout?: number
}

export const createHttpSuggestionProvider = (options: HttpSuggestionOptions): SuggestionProvider =>
  async function* ({ document, instruction, signal }) {
    const response = await ky.post(options.endpoint, {
      json: { document, instruction },
      signal,
      retry: 0,
      timeout: options.timeout ?? 30_000,
      headers: { Accept: "application/x-ndjson", ...options.headers },
    })
    if (response.body === null) throw new TypeError("Suggestion response has no stream")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (!signal.aborted) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        if (buffer.length > 2_000_000)
          throw new RangeError("Suggestion frame exceeds the document limit")
        for (const line of lines) {
          if (signal.aborted) return
          if (line.trim()) yield parseDocumentText(line)
        }
        if (chunk.done) {
          if (buffer.trim()) yield parseDocumentText(buffer)
          return
        }
      }
    } finally {
      try {
        await reader.cancel()
      } finally {
        reader.releaseLock()
      }
    }
  }

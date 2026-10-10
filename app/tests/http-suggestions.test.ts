import { once } from "node:events"
import { createServer } from "node:http"
import { expect, it } from "vitest"
import { createHttpSuggestionProvider } from "../src/core/http-suggestions"
import type { BlockDocument } from "../src/core/types"

it("streams validated candidate snapshots through a real HTTP endpoint", async () => {
  const document: BlockDocument = {
    format: "block-editor/v0.3",
    blocks: [
      {
        id: "p",
        type: "paragraph",
        attrs: {},
        content: [{ kind: "text", text: "문장", marks: [] }],
      },
    ],
  }
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/x-ndjson" })
    const payload = Buffer.from(`${JSON.stringify(document)}\n${JSON.stringify(document)}`)
    response.write(payload.subarray(0, 110))
    response.end(payload.subarray(110))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const address = server.address()
    if (address === null || typeof address === "string")
      throw new TypeError("Expected network address")
    const provider = createHttpSuggestionProvider({ endpoint: `http://127.0.0.1:${address.port}` })
    const received: BlockDocument[] = []
    for await (const snapshot of provider({
      document,
      instruction: "revise",
      signal: new AbortController().signal,
    }))
      received.push(snapshot)
    expect(received).toEqual([document, document])
  } finally {
    server.close()
    server.closeAllConnections()
  }
})

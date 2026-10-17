import { localContext } from "@slop-lab/part"
import { createToolDispatcher } from "@slop-lab/part/tools.js"
import { expect, it } from "vitest"
import { createDocumentTools } from "../server/agent/tools.mjs"

it("rejects non-status properties and unknown status options before sealing an artifact", async () => {
  const artifacts = []
  const tools = createDocumentTools({
    input: { sessionId: "session-1", target: { epoch: 1, baseVersion: 1 } },
    owner: { subject: "author", authority: "demo" },
    operationId: "operation-status",
    signal: new AbortController().signal,
    authoritative: {
      authority: { revision: 1 },
      context: {
        kind: "workspace",
        revision: 1,
        database: {
          id: "tasks",
          properties: [
            { id: "name", name: "Name", type: "text" },
            { id: "status", name: "Status", type: "status", options: ["대기", "완료"] },
          ],
          rows: [{ id: "row-1", values: { name: "Task", status: "대기" } }],
        },
      },
    },
    targetIsCurrent: async () => true,
    candidate: () => ({ format: "block-editor/v0.3", blocks: [] }),
    writeCandidate: async () => undefined,
    writeArtifact: async (artifact) => artifacts.push(artifact),
  })
  const dispatcher = createToolDispatcher({ tools })
  expect(dispatcher.ok).toBe(true)
  if (!dispatcher.ok) return

  for (const argumentsValue of [
    { rowId: "row-1", propertyId: "name", after: "Changed" },
    { rowId: "row-1", propertyId: "status", after: "알 수 없음" },
  ]) {
    const dispatched = await dispatcher.value.dispatch(
      {
        logicalCallId: crypto.randomUUID(),
        toolId: "propose_row_status_patch",
        arguments: argumentsValue,
      },
      localContext(),
    )
    expect(dispatched.ok).toBe(true)
    if (dispatched.ok) expect((await dispatched.value.done).phase).toBe("failed")
  }
  expect(artifacts).toEqual([])
})

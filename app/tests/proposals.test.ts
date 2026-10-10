import { expect, it } from "vitest"
import { acceptChanges, compareDocuments, SuggestionStream } from "../src/core/proposals"
import type { BlockDocument } from "../src/core/types"

const before: BlockDocument = { format: "block-editor/v0.3", blocks: [] }
const after: BlockDocument = {
  ...before,
  blocks: [
    { id: "card", type: "paragraph", attrs: {}, content: [] },
    { id: "caption", type: "caption", attrs: { refBlockId: "card" }, content: [] },
  ],
}
it("rejects partial acceptance missing a referenced insertion", () => {
  const changes = compareDocuments(before, after)
  const caption = changes.find((change) => change.blockId === "caption")
  expect(
    acceptChanges(before, {
      baseVersion: 0,
      currentVersion: 0,
      changes,
      selected: new Set(caption ? [caption.id] : []),
    }).kind,
  ).toBe("dependency")
  expect(
    acceptChanges(before, {
      baseVersion: 0,
      currentVersion: 0,
      changes,
      selected: new Set(changes.map((change) => change.id)),
    }).kind,
  ).toBe("accepted")
})
it("refuses stale proposal after source edits", () => {
  expect(
    acceptChanges(before, {
      baseVersion: 0,
      currentVersion: 1,
      changes: compareDocuments(before, after),
      selected: new Set(),
    }).kind,
  ).toBe("conflict")
})
it("isolates cancelled streams from later candidates", async () => {
  const stream = new SuggestionStream()
  const received: BlockDocument[] = []
  let resume = () => {}
  const gate = new Promise<void>((resolve) => {
    resume = resolve
  })
  const first = stream.start(
    async function* () {
      await gate
      yield after
    },
    { document: before, instruction: "old" },
    (value) => received.push(value),
  )
  await stream.start(
    async function* () {
      yield before
    },
    { document: before, instruction: "new" },
    (value) => received.push(value),
  )
  resume()
  expect(await first).toBe("cancelled")
  expect(received).toEqual([before])
})

import { expect, it } from "vitest"
import type { HostActionResult } from "../src/core/routing"
import {
  ActionRequests,
  dispatchInput,
  PersistenceBaseline,
  resolveRoute,
} from "../src/core/routing"
import type { BlockDocument } from "../src/core/types"

it("consumes host input synchronously without executing native editing", async () => {
  let edits = 0
  const result = dispatchInput(
    { kind: "host", actionHandle: "complete" },
    {
      native: () => {
        edits += 1
        return true
      },
      host: async () => ({ status: "completed" }),
      unavailable: () => {
        throw new Error("unexpected")
      },
    },
  )
  expect(result.handled).toBe(true)
  expect(edits).toBe(0)
  expect((await result.settled)?.status).toBe("completed")
})
it("exposes conflicting routes instead of selecting an arbitrary owner", () => {
  expect(resolveRoute([{ kind: "native" }, { kind: "host", actionHandle: "delete" }]).kind).toBe(
    "unavailable",
  )
})
it("ignores completion after cancellation without claiming server rollback", async () => {
  let complete: (result: HostActionResult) => void = () => {
    throw new Error("not started")
  }
  const requests = new ActionRequests(() => true)
  const action = requests.request(
    {
      actionHandle: "save",
      input: null,
      target: { modelId: "m", epoch: 1, blockId: "b", dependencyVersion: 1 },
    },
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  await Promise.resolve()
  action.cancel()
  complete({ status: "completed" })
  expect((await action.settled).status).toBe("stale")
})
it("does not clear newer draft B when save A completes", () => {
  const a: BlockDocument = { format: "block-editor/v0.3", blocks: [] }
  const b: BlockDocument = {
    ...a,
    blocks: [{ id: "b", type: "paragraph", attrs: {}, content: [] }],
  }
  const persistence = new PersistenceBaseline(a)
  const saveA = persistence.begin(a)
  persistence.acknowledge(saveA)
  expect(persistence.isDirty(b)).toBe(true)
  const saveB = persistence.begin(b)
  persistence.acknowledge(saveB)
  expect(persistence.acknowledge(saveA)).toBe(false)
  expect(persistence.isDirty(b)).toBe(false)
})

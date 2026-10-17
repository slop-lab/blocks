import ky from "ky"
import { z } from "zod"
import { parseDocumentText } from "./codec"
import type { SuggestionProvider } from "./proposals"

const sessionResultSchema = z.object({
  ok: z.literal(true),
  value: z.object({ sessionId: z.string() }),
})
const entitySchema = z.object({ owner: z.string(), kind: z.string(), id: z.string() })
const receiptSchema = z.object({
  kind: z.literal("accepted"),
  commandId: z.string(),
  operation: entitySchema,
})
const runSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
  candidate: z.unknown().nullable(),
  error: z.string().nullable(),
})
const itemSchema = z.object({ id: z.string(), payload: runSchema })
const snapshotSchema = z.object({ items: z.array(itemSchema), cursor: z.string() })
const streamFrameSchema = z.union([
  z.object({ kind: z.literal("bootstrap"), snapshot: snapshotSchema }),
  z.object({
    kind: z.literal("event"),
    event: z.object({ type: z.string(), payload: z.unknown() }),
  }),
  z.object({ kind: z.literal("reset"), snapshot: snapshotSchema }),
  z.object({ kind: z.literal("gap") }),
])

type AgentSuggestionTarget = {
  readonly modelId: string
  readonly epoch: number
  readonly baseVersion: number
  readonly taskId?: string
  readonly dependencyVersion?: number
}

const querySession = async () => {
  const payload = await ky
    .post("/api/agent/queries", {
      json: { queryId: "block-editor.agent/session", version: 1, input: null },
      retry: 0,
      timeout: 10_000,
    })
    .json()
  return sessionResultSchema.parse(payload).value.sessionId
}

const cancelRun = async (operation: z.infer<typeof entitySchema>) => {
  await ky.post("/api/agent/commands", {
    json: {
      protocolVersion: 1,
      commandId: crypto.randomUUID(),
      actionId: "block-editor.agent/cancel",
      actionVersion: 1,
      target: operation,
      input: "user-request",
    },
    retry: 0,
    timeout: 10_000,
  })
}

const runsFromFrame = (raw: unknown): readonly z.infer<typeof runSchema>[] => {
  const frame = streamFrameSchema.parse(raw)
  switch (frame.kind) {
    case "bootstrap":
    case "reset":
      return frame.snapshot.items.map((item) => item.payload)
    case "event": {
      if (frame.event.type !== "part.item/upsert") return []
      const item = itemSchema.safeParse(frame.event.payload)
      return item.success ? [item.data.payload] : []
    }
    case "gap":
      return []
    default: {
      const exhaustive: never = frame
      return exhaustive
    }
  }
}

export const createAgentSuggestionProvider = (
  target: AgentSuggestionTarget,
  kind: "proposal" | "task" = "proposal",
): SuggestionProvider =>
  async function* ({ document, instruction, signal }) {
    const sessionId = await querySession()
    const watch = await ky.post("/api/agent/events", {
      json: { surface: "agent-runs" },
      retry: 0,
      timeout: false,
    })
    if (watch.body === null) throw new TypeError("Agent event stream is unavailable")
    const receipt = receiptSchema.parse(
      await ky
        .post("/api/agent/commands", {
          json: {
            protocolVersion: 1,
            commandId: crypto.randomUUID(),
            actionId: "block-editor.agent/start",
            actionVersion: 1,
            input: {
              kind,
              requestId: crypto.randomUUID(),
              sessionId,
              instruction,
              target,
              document,
            },
          },
          retry: 0,
          timeout: 10_000,
        })
        .json(),
    )
    const reader = watch.body.getReader()
    const abort = () => {
      void reader.cancel()
      if (signal.reason === "execution-cancel") void cancelRun(receipt.operation)
    }
    signal.addEventListener("abort", abort, { once: true })
    const decoder = new TextDecoder("utf-8", { fatal: true })
    let buffered = ""
    try {
      while (!signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) return
        buffered += decoder.decode(chunk.value, { stream: true })
        if (new TextEncoder().encode(buffered).byteLength > 256 * 1024)
          throw new RangeError("Agent event frame is too large")
        const frames = buffered.split("\n\n")
        buffered = frames.pop() ?? ""
        for (const encoded of frames) {
          const data = encoded
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (!data) continue
          for (const run of runsFromFrame(JSON.parse(data))) {
            if (run.id !== receipt.operation.id) continue
            if (run.candidate !== null) yield parseDocumentText(JSON.stringify(run.candidate))
            if (run.status === "failed" || run.status === "interrupted")
              throw new TypeError(run.error ?? "Agent run did not complete")
            if (run.status === "cancelled" || run.status === "completed") return
          }
        }
      }
    } finally {
      signal.removeEventListener("abort", abort)
      await reader.cancel()
      reader.releaseLock()
    }
  }

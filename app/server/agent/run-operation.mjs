import { createAgent } from "@slop-lab/part-plugins/agent/index.js"
import { loadAuthoritativeCandidate } from "./authority.mjs"
import { runEvent } from "./lifecycle.mjs"
import { createDocumentTools, documentToolSchemas } from "./tools.mjs"

const isActive = (run) => run.status === "pending" || run.status === "running"
const terminalStatus = (outcome) => {
  if (outcome.phase === "completed" || outcome.phase === "cancelled") return outcome.phase
  return "failed"
}

export const startAgentOperation = async ({
  root,
  model,
  input,
  inputHash,
  owner,
  journal,
  update,
  notify,
  runGate,
  active,
  observeOperation,
  isShuttingDown,
}) => {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const authoritative = await loadAuthoritativeCandidate(root, input)
  let candidate = authoritative.document === null ? null : structuredClone(authoritative.document)
  let artifact = null
  const initial = await journal.put({
    schemaVersion: 1,
    id,
    owner,
    input,
    inputHash,
    provider: model.kind,
    providerLabel: model.label,
    status: "pending",
    cancellation: "not-requested",
    candidate,
    artifact,
    authority: authoritative.authority,
    application: "not-requested",
    applicationResult: null,
    commandReceipts: [],
    operation: null,
    events: [
      {
        id: 1,
        type: "authority.read",
        detail: authoritative.sources.join(", ").slice(0, 2_000),
        at: now,
      },
    ],
    error: null,
    createdAt: now,
    updatedAt: now,
  })
  notify(initial)

  const cancellation = new AbortController()
  const tools = createDocumentTools({
    input,
    owner,
    operationId: id,
    signal: cancellation.signal,
    authoritative,
    candidate: () => candidate,
    async targetIsCurrent() {
      const current = await loadAuthoritativeCandidate(root, input)
      return JSON.stringify(current.authority) === JSON.stringify(authoritative.authority)
    },
    async writeCandidate(document) {
      await runGate(id, async () => {
        const current = journal.get(id)
        if (cancellation.signal.aborted || current === null || !isActive(current)) return
        candidate = structuredClone(document)
        await update(id, (run) => ({
          ...run,
          candidate,
          updatedAt: new Date().toISOString(),
          events: [...run.events, runEvent(run, "tool.proposal", "review candidate updated")].slice(
            -100,
          ),
        }))
      })
    },
    async writeArtifact(nextArtifact) {
      await runGate(id, async () => {
        const current = journal.get(id)
        if (cancellation.signal.aborted || current === null || !isActive(current)) return
        artifact = structuredClone(nextArtifact)
        await update(id, (run) => ({
          ...run,
          artifact,
          updatedAt: new Date().toISOString(),
          events: [
            ...run.events,
            runEvent(run, "tool.proposal", `review artifact ${artifact.fingerprint}`),
          ].slice(-100),
        }))
      })
    },
  })
  const toolSchemas = Object.fromEntries(
    tools.map((tool) => [tool.id, documentToolSchemas[tool.id]]),
  )
  const created = createAgent({
    model: model.create(input),
    tools,
    toolSchemas,
    principal: owner,
    limits: {
      maxModelInvocations: 6,
      maxToolDispatches: 8,
      maxExecutorAttempts: 12,
      maxConcurrentOperations: 8,
      maxKnownTokens: 32_000,
      deadline: new Date(Date.now() + 60_000).toISOString(),
    },
  })
  if (!created.ok)
    return update(id, (run) => ({
      ...run,
      status: "failed",
      error: created.error.message,
      updatedAt: new Date().toISOString(),
    }))

  const started = await created.value.start(
    `Use the bounded tools in order. Read authoritative context, then create one exact review artifact for: ${input.instruction}`,
  )
  if (!started.ok) {
    await created.value.dispose()
    return update(id, (run) => ({
      ...run,
      status: "failed",
      error: started.error.message,
      updatedAt: new Date().toISOString(),
    }))
  }

  const observer = new AbortController()
  let disposed = false
  const disposeAgent = async () => {
    if (disposed) return
    disposed = true
    await created.value.dispose()
  }
  const running = await update(id, (run) => ({
    ...run,
    status: "running",
    operation: started.value.ref,
    updatedAt: new Date().toISOString(),
    events: [...run.events, runEvent(run, "run.started", "Part operation admitted")],
  }))
  const entry = {
    handle: started.value,
    observer,
    cancellation,
    disposeAgent,
    observation: Promise.resolve(),
    terminal: Promise.resolve(),
  }
  active.set(id, entry)
  entry.observation = (async () => {
    for await (const progress of observeOperation(started.value, {
      signal: observer.signal,
      bufferSize: 64,
    })) {
      if (progress.kind !== "gap") continue
      await runGate(id, () =>
        update(id, (run) => ({
          ...run,
          events: [
            ...run.events,
            runEvent(run, "run.progress-gap", "observer resync required"),
          ].slice(-100),
        })),
      )
    }
  })().catch(async (error) => {
    if (observer.signal.aborted || isShuttingDown()) return
    await runGate(id, () =>
      update(id, (run) => ({
        ...run,
        events: [
          ...run.events,
          runEvent(
            run,
            "observer.failed",
            error instanceof Error ? error.message : "observer failed",
          ),
        ].slice(-100),
      })),
    ).catch(() => undefined)
  })
  entry.terminal = started.value.done.then((outcome) =>
    runGate(id, async () => {
      await disposeAgent()
      if (!isShuttingDown()) {
        await update(id, (run) => {
          if (!isActive(run)) return run
          const status = terminalStatus(outcome)
          return {
            ...run,
            status,
            candidate,
            artifact,
            cancellation:
              status === "cancelled"
                ? "confirmed"
                : run.cancellation === "requested"
                  ? "partial"
                  : run.cancellation,
            error: "error" in outcome && outcome.error ? outcome.error.message : null,
            updatedAt: new Date().toISOString(),
            events: [
              ...run.events,
              runEvent(run, `run.${status}`, `Part operation ${outcome.phase}`),
            ].slice(-100),
          }
        })
      }
      if (active.get(id) === entry) active.delete(id)
    }),
  )
  return running
}

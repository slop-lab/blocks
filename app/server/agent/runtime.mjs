import { createAgent } from "@slop-lab/part-plugins/agent/index.js"
import { applyAuthoritativeCandidate, loadAuthoritativeCandidate } from "./authority.mjs"
import { AgentJournal } from "./journal.mjs"
import { createDocumentTools, documentToolSchemas } from "./tools.mjs"

const runEvent = (run, type, detail) => ({
  id: (run.events.at(-1)?.id ?? 0) + 1,
  type,
  detail: detail.slice(0, 2_000),
  at: new Date().toISOString(),
})

export const createAgentRuntime = async ({ root, model }) => {
  const journal = new AgentJournal(root)
  await journal.open()
  for (const run of journal.list()) {
    if (run.status !== "pending" && run.status !== "running") continue
    await journal.put({
      ...run,
      status: "interrupted",
      updatedAt: new Date().toISOString(),
      events: [
        ...run.events,
        runEvent(run, "run.interrupted", "server restarted; tools were not replayed"),
      ],
    })
  }
  const active = new Map()
  const listeners = new Set()
  let shuttingDown = false

  const update = async (id, change) => {
    const current = journal.get(id)
    if (current === null) throw new RangeError(`Unknown agent run ${id}`)
    const next = change(current)
    await journal.put(next)
    for (const listener of listeners) listener(structuredClone(next))
    return next
  }

  const start = async (raw, owner) => {
    const input = structuredClone(raw)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const authoritative = await loadAuthoritativeCandidate(root, input)
    let candidate = structuredClone(authoritative.document)
    const initial = {
      schemaVersion: 1,
      id,
      owner,
      input,
      provider: model.kind,
      providerLabel: model.label,
      status: "pending",
      cancellation: "not-requested",
      candidate,
      authority: authoritative.authority,
      application: "not-requested",
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
    }
    await journal.put(initial)
    for (const listener of listeners) listener(structuredClone(initial))
    const cancellation = new AbortController()
    const tools = createDocumentTools({
      input,
      owner,
      operationId: id,
      signal: cancellation.signal,
      candidate: () => candidate,
      async targetIsCurrent() {
        const current = await loadAuthoritativeCandidate(root, input)
        return JSON.stringify(current.authority) === JSON.stringify(authoritative.authority)
      },
      async writeCandidate(document) {
        candidate = structuredClone(document)
        await update(id, (run) => ({
          ...run,
          candidate,
          updatedAt: new Date().toISOString(),
          events: [...run.events, runEvent(run, "tool.proposal", "review candidate updated")].slice(
            -100,
          ),
        }))
      },
    })
    const created = createAgent({
      model: model.create(input),
      tools,
      toolSchemas: documentToolSchemas,
      principal: owner,
      limits: {
        maxModelInvocations: 4,
        maxToolDispatches: 8,
        maxExecutorAttempts: 12,
        maxConcurrentOperations: 8,
        maxKnownTokens: 32_000,
        deadline: new Date(Date.now() + 60_000).toISOString(),
      },
    })
    if (!created.ok) {
      return update(id, (run) => ({
        ...run,
        status: "failed",
        error: created.error.message,
        updatedAt: new Date().toISOString(),
      }))
    }
    const started = await created.value.start(
      `Use the bounded tools. Read authoritative context, then call candidate_patch exactly once for the requested instruction: ${input.instruction}`,
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
    const disposeAgent = async () => created.value.dispose()
    const running = await update(id, (run) => ({
      ...run,
      status: "running",
      operation: started.value.ref,
      updatedAt: new Date().toISOString(),
      events: [...run.events, runEvent(run, "run.started", "Part operation admitted")],
    }))
    void (async () => {
      for await (const progress of started.value.observe({
        signal: observer.signal,
        bufferSize: 64,
      })) {
        if (progress.kind !== "gap") continue
        await update(id, (run) => ({
          ...run,
          events: [
            ...run.events,
            runEvent(run, "run.progress-gap", "observer resync required"),
          ].slice(-100),
        }))
      }
    })()
    const terminal = started.value.done.then(async (outcome) => {
      active.delete(id)
      await disposeAgent()
      if (shuttingDown) return
      await update(id, (run) => {
        const status = outcome.phase === "completed" ? "completed" : outcome.phase
        return {
          ...run,
          status: status === "abandoned" ? "failed" : status,
          candidate,
          cancellation: outcome.phase === "cancelled" ? "confirmed" : run.cancellation,
          error: "error" in outcome && outcome.error ? outcome.error.message : null,
          updatedAt: new Date().toISOString(),
          events: [...run.events, runEvent(run, `run.${status}`, `Part operation ${status}`)].slice(
            -100,
          ),
        }
      })
    })
    active.set(id, { handle: started.value, observer, cancellation, disposeAgent, terminal })
    return running
  }

  const interruptForShutdown = async () => {
    shuttingDown = true
    await Promise.all(
      [...active.entries()].map(async ([id, running]) => {
        running.observer.abort()
        running.cancellation.abort("server-shutdown")
        await update(id, (run) => ({
          ...run,
          status: "interrupted",
          updatedAt: new Date().toISOString(),
          events: [...run.events, runEvent(run, "run.interrupted", "server shutdown")].slice(-100),
        }))
        await running.handle.requestCancel("server-shutdown")
        await running.handle.done
        await running.disposeAgent()
      }),
    )
    active.clear()
    listeners.clear()
  }

  return {
    start,
    get: async (id) => journal.get(id),
    list: async () => journal.list(),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async wait(id) {
      const running = active.get(id)
      if (running !== undefined) await running.terminal
      const record = journal.get(id)
      if (record === null) throw new RangeError(`Unknown agent run ${id}`)
      return record
    },
    async detach(id) {
      active.get(id)?.observer.abort()
    },
    async cancel(id, reason) {
      const running = active.get(id)
      if (running === undefined) return journal.get(id)
      await update(id, (run) => ({
        ...run,
        cancellation: "requested",
        updatedAt: new Date().toISOString(),
        events: [...run.events, runEvent(run, "run.cancel-requested", reason)].slice(-100),
      }))
      running.cancellation.abort(reason)
      await running.handle.requestCancel(reason)
      return journal.get(id)
    },
    async apply(id, actorId) {
      const run = journal.get(id)
      if (run === null) throw new RangeError(`Unknown agent run ${id}`)
      const result = await applyAuthoritativeCandidate(root, run, actorId)
      await update(id, (current) => ({
        ...current,
        application: result.kind === "applied" ? "applied" : "conflict",
        updatedAt: new Date().toISOString(),
        events: [
          ...current.events,
          runEvent(
            current,
            result.kind === "applied" ? "candidate.applied" : "candidate.conflict",
            result.kind === "applied"
              ? `authoritative revision ${result.revision}`
              : `actual revision ${result.actualRevision}`,
          ),
        ].slice(-100),
      }))
      return result
    },
    interruptForShutdown,
    async dispose() {
      await interruptForShutdown()
    },
  }
}
